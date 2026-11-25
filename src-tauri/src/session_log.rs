//! Log di sessione su disco, riutilizzabile per replay, mock-server e fixture.
//!
//! Formato (testo UTF-8, una voce per riga):
//! ```text
//! #nebbie-log v1 2026-11-13T10:00:00+01:00 Rigel
//! 120<TAB>L<TAB>riga del MUD con codici ANSI
//! 135<TAB>P<TAB>prompt senza a capo
//! 2010<TAB>C<TAB>comando inviato
//! ```
//! Il primo numero sono i millisecondi dall'inizio della sessione. Tipi: `L` riga, `P` riga
//! parziale (prompt), `C` comando inviato, `S` messaggio del client. `\` e tab nel testo sono
//! scritti come `\\` e `\t`. Le password non vengono mai scritte.
//! Un file di testo qualsiasi (es. log di Mudlet) si legge comunque: ogni riga vale come `L`.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const HEADER: &str = "#nebbie-log v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Line,
    Partial,
    Command,
    System,
}

impl Kind {
    fn code(self) -> char {
        match self {
            Kind::Line => 'L',
            Kind::Partial => 'P',
            Kind::Command => 'C',
            Kind::System => 'S',
        }
    }

    fn from_code(c: &str) -> Option<Self> {
        match c {
            "L" => Some(Kind::Line),
            "P" => Some(Kind::Partial),
            "C" => Some(Kind::Command),
            "S" => Some(Kind::System),
            _ => None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Entry {
    /// Millisecondi dall'inizio; `None` per i file di testo semplice.
    pub ms: Option<u64>,
    pub kind: Kind,
    pub text: String,
}

pub struct SessionLog {
    out: BufWriter<File>,
    start: Instant,
}

impl SessionLog {
    /// Crea `<dir>/<profilo>_<data-ora>.log`.
    pub fn create(dir: &Path, profile: &str) -> io::Result<(Self, PathBuf)> {
        fs::create_dir_all(dir)?;
        let now = chrono::Local::now();
        let name = format!(
            "{}_{}.log",
            safe_file_name(profile),
            now.format("%Y-%m-%d_%H-%M-%S")
        );
        let path = dir.join(name);
        let mut out = BufWriter::new(File::create(&path)?);
        writeln!(out, "{HEADER} {} {}", now.to_rfc3339(), escape(profile))?;
        Ok((
            Self {
                out,
                start: Instant::now(),
            },
            path,
        ))
    }

    pub fn write(&mut self, kind: Kind, text: &str) -> io::Result<()> {
        let ms = self.start.elapsed().as_millis();
        writeln!(self.out, "{ms}\t{}\t{}", kind.code(), escape(text))
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }
}

impl Drop for SessionLog {
    fn drop(&mut self) {
        let _ = self.out.flush();
    }
}

/// Log non compressi da tenere: i più vecchi diventano `.log.gz` (richiesta del 2026-11-15).
pub const KEEP_PLAIN: usize = 5;

/**
 * Comprime con gzip i log `.log` della cartella tranne i `keep` più recenti (per data di
 * modifica): `x.log` → `x.log.gz`, poi il `.log` si cancella. Se qualcosa va storto il `.log`
 * resta com'è. Restituisce quanti file ha compresso.
 */
pub fn compress_old(dir: &Path, keep: usize) -> io::Result<usize> {
    let mut logs: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for e in fs::read_dir(dir)? {
        let p = e?.path();
        if p.extension().is_some_and(|x| x == "log") && p.is_file() {
            let t = fs::metadata(&p)?.modified()?;
            logs.push((t, p));
        }
    }
    logs.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let mut n = 0;
    for (_, p) in logs.into_iter().skip(keep) {
        if compress_one(&p).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

fn compress_one(p: &Path) -> io::Result<()> {
    let gz = p.with_extension("log.gz");
    let tmp = p.with_extension("log.gz.tmp");
    {
        let mut input = BufReader::new(File::open(p)?);
        let mut enc = flate2::write::GzEncoder::new(
            BufWriter::new(File::create(&tmp)?),
            flate2::Compression::best(),
        );
        io::copy(&mut input, &mut enc)?;
        enc.finish()?.flush()?;
    }
    // il .gz tiene la data del log originale (nel Finder restano in ordine)
    if let Ok(t) = fs::metadata(p).and_then(|m| m.modified()) {
        let _ = File::options()
            .write(true)
            .open(&tmp)
            .and_then(|f| f.set_modified(t));
    }
    fs::rename(&tmp, &gz)?;
    fs::remove_file(p)
}

/// Contenuto di un log, compresso (`.gz`) o no.
pub fn read_bytes(p: &Path) -> io::Result<Vec<u8>> {
    let raw = fs::read(p)?;
    if p.extension().is_some_and(|x| x == "gz") {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&raw[..]).read_to_end(&mut out)?;
        Ok(out)
    } else {
        Ok(raw)
    }
}

/// Legge una riga di log. Restituisce `None` per l'intestazione.
pub fn parse_line(line: &str) -> Option<Entry> {
    if line.starts_with(HEADER) {
        return None;
    }
    let mut parts = line.splitn(3, '\t');
    if let (Some(ms), Some(code), Some(text)) = (parts.next(), parts.next(), parts.next())
        && let (Ok(ms), Some(kind)) = (ms.parse::<u64>(), Kind::from_code(code))
    {
        return Some(Entry {
            ms: Some(ms),
            kind,
            text: unescape(text),
        });
    }
    Some(Entry {
        ms: None,
        kind: Kind::Line,
        text: line.trim_end_matches('\r').to_string(),
    })
}

/// Legge un intero file di log (o di testo semplice) già decodificato.
pub fn parse(text: &str) -> Vec<Entry> {
    text.lines().filter_map(parse_line).collect()
}

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\t', "\\t")
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn safe_file_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() { "sessione".into() } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrive_e_rilegge() {
        let dir = std::env::temp_dir().join(format!("nebbie-log-test-{}", std::process::id()));
        let (mut log, path) = SessionLog::create(&dir, "Pg di prova").unwrap();
        log.write(Kind::Line, "\x1b[31mrosso\tcon tab \\ e barra")
            .unwrap();
        log.write(Kind::Partial, "X H1 M2 V3 X4>> ").unwrap();
        log.write(Kind::Command, "nord").unwrap();
        drop(log);

        assert!(
            path.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("Pg_di_prova_")
        );
        let entries = parse(&fs::read_to_string(&path).unwrap());
        fs::remove_dir_all(&dir).unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].kind, Kind::Line);
        assert_eq!(entries[0].text, "\x1b[31mrosso\tcon tab \\ e barra");
        assert_eq!(entries[1].kind, Kind::Partial);
        assert_eq!(entries[2].kind, Kind::Command);
        assert!(entries.iter().all(|e| e.ms.is_some()));
    }

    #[test]
    fn testo_semplice_letto_come_righe() {
        let entries = parse("Uscite: Nord\r\nIl tuo sangue si gela\n");
        assert_eq!(
            entries,
            vec![
                Entry {
                    ms: None,
                    kind: Kind::Line,
                    text: "Uscite: Nord".into()
                },
                Entry {
                    ms: None,
                    kind: Kind::Line,
                    text: "Il tuo sangue si gela".into()
                },
            ]
        );
    }

    #[test]
    fn riga_con_tab_ma_non_di_log_resta_testo() {
        let e = parse_line("12a\tL\tciao").unwrap();
        assert_eq!(e.ms, None);
        assert_eq!(e.text, "12a\tL\tciao");
    }

    #[test]
    fn comprime_tutti_tranne_gli_ultimi() {
        let dir = std::env::temp_dir().join(format!("nebbie-gz-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for i in 0..8 {
            let p = dir.join(format!("Pg_{i}.log"));
            fs::write(&p, format!("{HEADER} x Pg\n0\tL\triga {i}\n").repeat(50)).unwrap();
            let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i);
            File::options()
                .write(true)
                .open(&p)
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        assert_eq!(compress_old(&dir, 5).unwrap(), 3);
        for i in 0..3 {
            assert!(!dir.join(format!("Pg_{i}.log")).exists());
            let back = read_bytes(&dir.join(format!("Pg_{i}.log.gz"))).unwrap();
            assert!(
                String::from_utf8(back)
                    .unwrap()
                    .contains(&format!("riga {i}"))
            );
        }
        for i in 3..8 {
            assert!(dir.join(format!("Pg_{i}.log")).exists());
        }
        assert_eq!(compress_old(&dir, 5).unwrap(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
