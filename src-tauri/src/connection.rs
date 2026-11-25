//! Connessione TCP al MUD: legge, passa il testo nella pipeline, manda gli eventi al
//! frontend e scrive i comandi. Non si riconnette mai da sola.

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::{Instant, sleep_until, timeout};

use crate::decode::Encoding;
use crate::pipeline::{ConnState, Output, Pipeline, ServerEvent, WireLine};
use crate::session_log::{Kind, SessionLog};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Dopo quanto il testo senza `\n` viene consegnato come prompt se il server non manda GA/EOR.
pub const PARTIAL_TIMEOUT: Duration = Duration::from_millis(150);

pub enum Cmd {
    Send(String),
    /// Testo da non registrare (password, nome utente): mandato al server, mai scritto nel log.
    SendSecret(String),
    Disconnect,
}

pub struct ConnectParams {
    pub host: String,
    pub port: u16,
    pub encoding: Encoding,
    pub log: Option<SessionLog>,
}

pub async fn run<E>(params: ConnectParams, mut rx: UnboundedReceiver<Cmd>, emit: E)
where
    E: Fn(ServerEvent) + Send,
{
    let ConnectParams {
        host,
        port,
        encoding,
        mut log,
    } = params;

    emit(status(
        ConnState::Connecting,
        format!("Connessione a {host}:{port}…"),
    ));
    let stream = match timeout(CONNECT_TIMEOUT, TcpStream::connect((host.as_str(), port))).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            emit(status(
                ConnState::Disconnected,
                format!("Connessione non riuscita: {e}"),
            ));
            return;
        }
        Err(_) => {
            emit(status(
                ConnState::Disconnected,
                "Connessione non riuscita: tempo scaduto.".into(),
            ));
            return;
        }
    };
    let _ = stream.set_nodelay(true);
    let keepalive = socket2::TcpKeepalive::new().with_time(Duration::from_secs(60));
    let _ = socket2::SockRef::from(&stream).set_tcp_keepalive(&keepalive);
    emit(status(
        ConnState::Connected,
        format!("Collegato a {host}:{port}."),
    ));

    let (mut rd, mut wr) = stream.into_split();
    let mut pipe = Pipeline::new(encoding);
    let mut buf = vec![0u8; 16 * 1024];
    let mut deadline: Option<Instant> = None;
    let mut password = false;
    // Diagnostica nel log: il server segnala la fine del prompt o serve il timeout?
    let mut timeout_flushes: u64 = 0;
    let mut ga_reported = false;

    let reason = loop {
        let timer = async {
            match deadline {
                Some(d) => sleep_until(d).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            r = rd.read(&mut buf) => match r {
                Ok(0) => break "Connessione chiusa dal server.".to_string(),
                Ok(n) => {
                    let outs = pipe.feed(&buf[..n]);
                    let replies = pipe.take_replies();
                    if !replies.is_empty()
                        && let Err(e) = wr.write_all(&replies).await
                    {
                        break format!("Errore di scrittura: {e}");
                    }
                    deliver(outs, &mut log, &emit, &mut password);
                    if !ga_reported && pipe.prompt_ends() > 0 {
                        ga_reported = true;
                        write_log(&mut log, &emit, Kind::System,
                            "Il server segnala la fine del prompt (GA/EOR).");
                    }
                    deadline = pipe.has_partial().then(|| Instant::now() + PARTIAL_TIMEOUT);
                }
                Err(e) => break format!("Errore di lettura: {e}"),
            },
            _ = timer => {
                deadline = None;
                timeout_flushes += 1;
                deliver(pipe.flush_partial(), &mut log, &emit, &mut password);
            }
            cmd = rx.recv() => match cmd {
                Some(Cmd::Send(text)) => {
                    if let Err(e) = wr.write_all(&pipe.encode(&text)).await {
                        break format!("Errore di scrittura: {e}");
                    }
                    // Con l'eco del server attivo si sta scrivendo una password: mai nel log.
                    if !password {
                        write_log(&mut log, &emit, Kind::Command, &text);
                    }
                }
                Some(Cmd::SendSecret(text)) => {
                    if let Err(e) = wr.write_all(&pipe.encode(&text)).await {
                        break format!("Errore di scrittura: {e}");
                    }
                }
                Some(Cmd::Disconnect) | None => break "Disconnesso.".to_string(),
            }
        }
    };

    deliver(pipe.flush_partial(), &mut log, &emit, &mut password);
    write_log(
        &mut log,
        &emit,
        Kind::System,
        &format!(
            "Righe parziali consegnate: {} dopo GA/EOR, {timeout_flushes} dopo il timeout di {} ms.",
            pipe.prompt_ends(),
            PARTIAL_TIMEOUT.as_millis()
        ),
    );
    write_log(&mut log, &emit, Kind::System, &reason);
    if let Some(l) = log.as_mut() {
        let _ = l.flush();
    }
    emit(status(ConnState::Disconnected, reason));
}

/// Manda al frontend le righe raggruppate (un evento per lettura) e le scrive nel log.
fn deliver<E: Fn(ServerEvent)>(
    outs: Vec<Output>,
    log: &mut Option<SessionLog>,
    emit: &E,
    password: &mut bool,
) {
    let mut batch: Vec<WireLine> = Vec::new();
    for out in outs {
        match out {
            Output::Line(line) => {
                let kind = if line.partial {
                    Kind::Partial
                } else {
                    Kind::Line
                };
                write_log(log, emit, kind, &line.raw);
                batch.push(line.into());
            }
            Output::ServerEcho(on) => {
                if !batch.is_empty() {
                    emit(ServerEvent::Lines {
                        lines: std::mem::take(&mut batch),
                    });
                }
                *password = on;
                emit(ServerEvent::ServerEcho { on });
            }
        }
    }
    if !batch.is_empty() {
        emit(ServerEvent::Lines { lines: batch });
    }
    if let Some(l) = log.as_mut() {
        let _ = l.flush();
    }
}

/// Scrive nel log; al primo errore lo disattiva e avvisa (senza interrompere il gioco).
fn write_log<E: Fn(ServerEvent)>(log: &mut Option<SessionLog>, emit: &E, kind: Kind, text: &str) {
    if let Some(l) = log.as_mut()
        && let Err(e) = l.write(kind, text)
    {
        *log = None;
        emit(ServerEvent::Error {
            message: format!("Log di sessione disattivato: {e}"),
        });
    }
}

pub fn status(state: ConnState, message: String) -> ServerEvent {
    ServerEvent::Status { state, message }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn collega_riceve_righe_e_invia_comandi() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            sock.write_all(b"Benvenuto\r\nPg H1 M2 V3 X4>> ")
                .await
                .unwrap();
            let mut buf = [0u8; 64];
            let n = sock.read(&mut buf).await.unwrap();
            // Il socket resta aperto: lo restituiamo per chiuderlo solo alla fine del test.
            (String::from_utf8_lossy(&buf[..n]).to_string(), sock)
        });

        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let (tx, rx) = mpsc::unbounded_channel();
        let params = ConnectParams {
            host: "127.0.0.1".into(),
            port,
            encoding: Encoding::Utf8,
            log: None,
        };
        let client = tokio::spawn(run(params, rx, move |ev| sink.lock().unwrap().push(ev)));

        tx.send(Cmd::Send("nord".into())).unwrap();
        let (received, _sock) = server.await.unwrap();
        assert_eq!(received, "nord\r\n");
        tokio::time::sleep(PARTIAL_TIMEOUT * 2).await; // lascia scadere il timeout del prompt
        tx.send(Cmd::Disconnect).unwrap();
        client.await.unwrap();

        let events = events.lock().unwrap();
        let mut texts = Vec::new();
        for ev in events.iter() {
            if let ServerEvent::Lines { lines } = ev {
                for l in lines {
                    let t: String = l.spans.iter().map(|s| s.text.as_str()).collect();
                    texts.push((t, l.partial));
                }
            }
        }
        assert_eq!(
            texts,
            vec![
                ("Benvenuto".to_string(), false),
                ("Pg H1 M2 V3 X4>> ".to_string(), true)
            ]
        );
        assert!(matches!(
            events.last(),
            Some(ServerEvent::Status {
                state: ConnState::Disconnected,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn connessione_rifiutata_segnalata() {
        // Porta presa e subito liberata: nessuno in ascolto.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let (_tx, rx) = mpsc::unbounded_channel();
        let params = ConnectParams {
            host: "127.0.0.1".into(),
            port,
            encoding: Encoding::Utf8,
            log: None,
        };
        run(params, rx, move |ev| sink.lock().unwrap().push(ev)).await;
        let events = events.lock().unwrap();
        assert!(matches!(
            events.last(),
            Some(ServerEvent::Status { state: ConnState::Disconnected, message })
                if message.starts_with("Connessione non riuscita")
        ));
    }
}
