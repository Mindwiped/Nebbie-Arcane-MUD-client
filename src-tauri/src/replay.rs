//! Replay di un log di sessione (o di un file di testo qualsiasi) nella stessa pipeline
//! della connessione vera. Non manda nulla al MUD.

use std::path::Path;
use std::time::Duration;

use tokio::sync::watch;

use crate::connection::status;
use crate::decode::{Decoder, Encoding};
use crate::pipeline::{ConnState, Pipeline, ServerEvent, WireLine};
use crate::session_log::{self, Kind};

/// Pausa massima tra due righe: le lunghe attese della sessione originale vengono accorciate.
const MAX_GAP: Duration = Duration::from_secs(2);
/// Pausa per riga nei file di testo senza tempi (a velocità 1).
const PLAIN_STEP: Duration = Duration::from_millis(30);
/// Sotto questa soglia le pause si accumulano invece di dormire riga per riga.
const MIN_SLEEP: Duration = Duration::from_millis(10);
const MAX_BATCH: usize = 500;

/// `speed`: 1 = tempi originali, 2 = doppia velocità, 0 = tutto subito.
pub async fn run<E>(path: &Path, speed: f64, mut cancel: watch::Receiver<bool>, emit: E)
where
    E: Fn(ServerEvent) + Send,
{
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let p = path.to_path_buf();
    let read = tokio::task::spawn_blocking(move || session_log::read_bytes(&p)).await;
    let bytes = match read.unwrap_or_else(|e| Err(std::io::Error::other(e.to_string()))) {
        Ok(b) => b,
        Err(e) => {
            emit(status(
                ConnState::ReplayEnded,
                format!("Impossibile leggere {name}: {e}"),
            ));
            return;
        }
    };
    let mut decoder = Decoder::new(Encoding::Utf8);
    let mut text = decoder.decode(&bytes);
    text.push_str(&decoder.flush());
    let entries = session_log::parse(&text);
    emit(status(
        ConnState::Replay,
        format!("Replay di {name} ({} righe).", entries.len()),
    ));

    let mut pipe = Pipeline::new(Encoding::Utf8);
    let mut batch: Vec<WireLine> = Vec::new();
    let mut prev_ms: Option<u64> = None;
    let mut debt = Duration::ZERO;
    let mut stopped = false;

    for entry in entries {
        if speed > 0.0 {
            let gap = match (entry.ms, prev_ms) {
                (Some(ms), Some(prev)) => {
                    Duration::from_millis(ms.saturating_sub(prev)).min(MAX_GAP)
                }
                (None, _) => PLAIN_STEP,
                _ => Duration::ZERO,
            };
            debt += gap.div_f64(speed);
            if debt >= MIN_SLEEP {
                flush(&mut batch, &emit);
                tokio::select! {
                    _ = tokio::time::sleep(debt) => {}
                    _ = cancel.changed() => { stopped = true; break; }
                }
                debt = Duration::ZERO;
            }
        } else if *cancel.borrow() {
            stopped = true;
            break;
        }
        prev_ms = entry.ms.or(prev_ms);

        match entry.kind {
            Kind::Line | Kind::Partial => {
                batch.push(pipe.line(entry.text, entry.kind == Kind::Partial).into());
                if batch.len() >= MAX_BATCH {
                    flush(&mut batch, &emit);
                    tokio::task::yield_now().await;
                }
            }
            Kind::Command => {
                flush(&mut batch, &emit);
                emit(ServerEvent::Echo { text: entry.text });
            }
            Kind::System => {}
        }
    }
    flush(&mut batch, &emit);
    let message = if stopped {
        "Replay interrotto."
    } else {
        "Replay finito."
    };
    emit(status(ConnState::ReplayEnded, message.into()));
}

fn flush<E: Fn(ServerEvent)>(batch: &mut Vec<WireLine>, emit: &E) {
    if !batch.is_empty() {
        emit(ServerEvent::Lines {
            lines: std::mem::take(batch),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn replay_immediato_di_un_log() {
        let path = std::env::temp_dir().join(format!("nebbie-replay-{}.log", std::process::id()));
        std::fs::write(
            &path,
            "#nebbie-log v1 x Pg\n0\tL\tUscite: Nord\n5\tP\tPg H1 M2 V3 X4>> \n9\tC\tnord\n",
        )
        .unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let (_tx, rx) = watch::channel(false);
        run(&path, 0.0, rx, move |ev| sink.lock().unwrap().push(ev)).await;
        std::fs::remove_file(&path).unwrap();

        let events = events.lock().unwrap();
        let kinds: Vec<String> = events
            .iter()
            .map(|e| match e {
                ServerEvent::Lines { lines } => format!("righe:{}", lines.len()),
                ServerEvent::Echo { text } => format!("eco:{text}"),
                ServerEvent::Status { state, .. } => format!("{state:?}"),
                _ => "altro".into(),
            })
            .collect();
        assert_eq!(kinds, vec!["Replay", "righe:2", "eco:nord", "ReplayEnded"]);
    }
}
