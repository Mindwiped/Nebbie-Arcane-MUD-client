//! Backend di Nebbie Client: connessione, telnet, decodifica, log, replay e dati su disco.
//! Il testo del MUD viene interpretato nel frontend; qui arriva già diviso in righe e span.

pub mod ansi;
pub mod connection;
pub mod credentials;
pub mod decode;
pub mod lines;
pub mod mock;
pub mod pipeline;
pub mod replay;
pub mod session_log;
pub mod storage;
pub mod telnet;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::sync::{mpsc, watch};

use connection::{Cmd, ConnectParams};
use decode::Encoding;
use pipeline::ServerEvent;
use session_log::SessionLog;

#[derive(Default)]
struct AppState {
    next_id: AtomicU64,
    conn: Mutex<Option<(u64, mpsc::UnboundedSender<Cmd>)>>,
    replay: Mutex<Option<(u64, watch::Sender<bool>)>>,
}

impl AppState {
    fn id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}

type CmdResult<T = ()> = Result<T, String>;

/// Restituisce nome e versione del backend (usato dal frontend come controllo di salute).
#[tauri::command]
fn versione_backend() -> String {
    format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
}

fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Cartella dati non disponibile: {e}"))
}

fn logs_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(data_dir(app)?.join("logs"))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn connetti(
    app: AppHandle,
    state: State<'_, AppState>,
    host: String,
    porta: u16,
    codifica: Encoding,
    profilo: String,
    registra: bool,
    canale: Channel<ServerEvent>,
) -> CmdResult {
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    if conn.as_ref().is_some_and(|(_, tx)| !tx.is_closed()) {
        return Err("Sei già collegato: scollegati prima.".into());
    }

    let log = if registra {
        let dir = logs_dir(&app)?;
        match SessionLog::create(&dir, &profilo) {
            Ok((log, path)) => {
                // i log vecchi si comprimono in sottofondo (restano gli ultimi 5 in chiaro)
                let d = dir.clone();
                std::thread::spawn(move || session_log::compress_old(&d, session_log::KEEP_PLAIN));
                let _ = canale.send(connection::status(
                    pipeline::ConnState::Connecting,
                    format!("Log di sessione: {}", path.display()),
                ));
                Some(log)
            }
            Err(e) => {
                let _ = canale.send(ServerEvent::Error {
                    message: format!("Log di sessione non creato: {e}"),
                });
                None
            }
        }
    } else {
        None
    };

    let id = state.id();
    let (tx, rx) = mpsc::unbounded_channel();
    *conn = Some((id, tx));
    let params = ConnectParams {
        host: host.trim().to_string(),
        port: porta,
        encoding: codifica,
        log,
    };
    tauri::async_runtime::spawn(async move {
        let sink = canale.clone();
        connection::run(params, rx, move |ev| {
            let _ = sink.send(ev);
        })
        .await;
        // Libera lo stato solo se nel frattempo non è partita un'altra connessione.
        let state = app.state::<AppState>();
        if let Ok(mut conn) = state.conn.lock()
            && conn.as_ref().is_some_and(|(cid, _)| *cid == id)
        {
            *conn = None;
        }
    });
    Ok(())
}

/// Manda un comando al MUD. Con `registra: false` il testo non finisce nel log di sessione
/// (usato per il nome utente dell'accesso automatico, spesso un'email).
#[tauri::command]
fn invia(state: State<'_, AppState>, testo: String, registra: Option<bool>) -> CmdResult {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let cmd = if registra == Some(false) {
        Cmd::SendSecret(testo)
    } else {
        Cmd::Send(testo)
    };
    match conn.as_ref() {
        Some((_, tx)) => tx.send(cmd).map_err(|_| "Non sei collegato.".to_string()),
        None => Err("Non sei collegato.".into()),
    }
}

/// Salva la password dell'account nel portachiavi del sistema.
#[tauri::command]
fn salva_password(host: String, utente: String, password: String) -> CmdResult {
    credentials::save(&host, &utente, &password)
}

#[tauri::command]
fn elimina_password(host: String, utente: String) -> CmdResult {
    credentials::delete(&host, &utente)
}

#[tauri::command]
fn password_salvata(host: String, utente: String) -> CmdResult<bool> {
    credentials::exists(&host, &utente)
}

/// Manda al server la password presa dal portachiavi: il frontend non la vede mai.
#[tauri::command]
fn invia_password(state: State<'_, AppState>, host: String, utente: String) -> CmdResult {
    let password = credentials::get(&host, &utente)?
        .ok_or_else(|| format!("Nessuna password salvata per {utente}."))?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    match conn.as_ref() {
        Some((_, tx)) => tx
            .send(Cmd::SendSecret(password))
            .map_err(|_| "Non sei collegato.".to_string()),
        None => Err("Non sei collegato.".into()),
    }
}

#[tauri::command]
fn disconnetti(state: State<'_, AppState>) -> CmdResult {
    if let Some((_, tx)) = state.conn.lock().map_err(|e| e.to_string())?.as_ref() {
        let _ = tx.send(Cmd::Disconnect);
    }
    Ok(())
}

#[tauri::command]
fn avvia_replay(
    app: AppHandle,
    state: State<'_, AppState>,
    percorso: String,
    velocita: f64,
    canale: Channel<ServerEvent>,
) -> CmdResult {
    let mut replay = state.replay.lock().map_err(|e| e.to_string())?;
    if let Some((_, stop)) = replay.take() {
        let _ = stop.send(true);
    }
    let id = state.id();
    let (stop_tx, stop_rx) = watch::channel(false);
    *replay = Some((id, stop_tx));
    tauri::async_runtime::spawn(async move {
        let sink = canale.clone();
        replay::run(&PathBuf::from(percorso), velocita, stop_rx, move |ev| {
            let _ = sink.send(ev);
        })
        .await;
        let state = app.state::<AppState>();
        if let Ok(mut replay) = state.replay.lock()
            && replay.as_ref().is_some_and(|(rid, _)| *rid == id)
        {
            *replay = None;
        }
    });
    Ok(())
}

#[tauri::command]
fn ferma_replay(state: State<'_, AppState>) -> CmdResult {
    if let Some((_, stop)) = state.replay.lock().map_err(|e| e.to_string())?.take() {
        let _ = stop.send(true);
    }
    Ok(())
}

#[tauri::command]
fn leggi_dati(app: AppHandle, nome: String) -> CmdResult<Option<String>> {
    storage::read(&data_dir(&app)?, &nome).map_err(|e| format!("Lettura di {nome}: {e}"))
}

#[tauri::command]
fn scrivi_dati(app: AppHandle, nome: String, contenuto: String) -> CmdResult {
    storage::write(&data_dir(&app)?, &nome, &contenuto)
        .map_err(|e| format!("Salvataggio di {nome}: {e}"))
}

#[tauri::command]
fn leggi_reliquiario(cartella: String) -> CmdResult<Option<String>> {
    storage::read_relics(&cartella).map_err(|e| e.to_string())
}

#[tauri::command]
fn leggi_bestiario(cartella: String) -> CmdResult<Option<String>> {
    storage::read_mobs(&cartella).map_err(|e| e.to_string())
}

#[tauri::command]
fn scrivi_reliquiario(cartella: String, contenuto: String) -> CmdResult {
    storage::write_relics(&cartella, &contenuto).map_err(|e| e.to_string())
}

#[tauri::command]
fn cartella_log(app: AppHandle) -> CmdResult<String> {
    Ok(logs_dir(&app)?.display().to_string())
}

#[derive(Serialize, Debug, PartialEq)]
struct ReplayArgs {
    percorso: String,
    velocita: f64,
}

/// `nebbie-client --replay file.log [--velocita 2]`: replay chiesto dalla riga di comando.
#[tauri::command]
fn argomenti_avvio() -> Option<ReplayArgs> {
    parse_args(std::env::args().skip(1))
}

fn parse_args(args: impl Iterator<Item = String>) -> Option<ReplayArgs> {
    let args: Vec<String> = args.collect();
    let value = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let percorso = value("--replay")?;
    let velocita = value("--velocita")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1.0);
    Some(ReplayArgs { percorso, velocita })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .setup(|app| {
            if let Ok(dir) = logs_dir(app.handle()) {
                std::thread::spawn(move || {
                    session_log::compress_old(&dir, session_log::KEEP_PLAIN)
                });
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            versione_backend,
            connetti,
            invia,
            disconnetti,
            salva_password,
            elimina_password,
            password_salvata,
            invia_password,
            avvia_replay,
            ferma_replay,
            leggi_dati,
            scrivi_dati,
            leggi_reliquiario,
            scrivi_reliquiario,
            leggi_bestiario,
            cartella_log,
            argomenti_avvio,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio dell'applicazione Tauri");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versione_backend_contiene_nome_e_versione() {
        let v = versione_backend();
        assert!(v.starts_with("nebbie-client "));
        assert!(v.ends_with(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn argomenti_replay() {
        let a = |s: &str| {
            s.split(' ')
                .map(String::from)
                .collect::<Vec<_>>()
                .into_iter()
        };
        assert_eq!(parse_args(a("--qualcosa")), None);
        assert_eq!(
            parse_args(a("--replay f.log --velocita 3")),
            Some(ReplayArgs {
                percorso: "f.log".into(),
                velocita: 3.0
            })
        );
        assert_eq!(parse_args(a("--replay f.log")).unwrap().velocita, 1.0);
    }
}
