//! Piccoli documenti JSON dell'applicazione (profili, impostazioni) nella cartella dati.
//! Il frontend decide il contenuto; il backend controlla solo il nome e scrive in modo atomico.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Solo lettere minuscole, cifre e `_`: niente percorsi arbitrari dal frontend.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 40
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn path_for(dir: &Path, name: &str) -> io::Result<PathBuf> {
    if valid_name(name) {
        Ok(dir.join(format!("{name}.json")))
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("nome non valido: {name:?}"),
        ))
    }
}

pub fn read(dir: &Path, name: &str) -> io::Result<Option<String>> {
    match fs::read_to_string(path_for(dir, name)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Scrive in un file temporaneo e poi lo rinomina: un crash non lascia file a metà.
pub fn write(dir: &Path, name: &str, content: &str) -> io::Result<()> {
    let path = path_for(dir, name)?;
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, &path)
}

/// Il Reliquiario (`identi.js`, letto dalla pagina `identi.html`) nella cartella scelta
/// dall'utente. Il frontend sceglie solo la cartella: il nome del file è fisso.
pub const RELIC_FILE: &str = "identi.js";
/// Il database dei mob (`mob.js`) accanto al Reliquiario, generato dai file d'area (sola lettura).
pub const MOB_FILE: &str = "mob.js";

fn relic_path(folder: &str) -> io::Result<PathBuf> {
    folder_file(folder, RELIC_FILE)
}

fn folder_file(folder: &str, file: &str) -> io::Result<PathBuf> {
    let dir = Path::new(folder);
    if !dir.is_absolute() || folder.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("cartella non valida: {folder:?}"),
        ));
    }
    Ok(dir.join(file))
}

pub fn read_relics(folder: &str) -> io::Result<Option<String>> {
    match fs::read_to_string(relic_path(folder)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn read_mobs(folder: &str) -> io::Result<Option<String>> {
    match fs::read_to_string(folder_file(folder, MOB_FILE)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Come `write`: file temporaneo e poi rinomina (la pagina non legge mai un file a metà).
pub fn write_relics(folder: &str, content: &str) -> io::Result<()> {
    let path = relic_path(folder)?;
    fs::create_dir_all(Path::new(folder))?;
    let tmp = path.with_extension("js.tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomi_validi_e_non() {
        assert!(valid_name("profili"));
        assert!(valid_name("layout_2"));
        assert!(!valid_name("../segreti"));
        assert!(!valid_name("Profili"));
        assert!(!valid_name(""));
    }

    #[test]
    fn scrive_e_legge() {
        let dir = std::env::temp_dir().join(format!("nebbie-storage-{}", std::process::id()));
        assert_eq!(read(&dir, "profili").unwrap(), None);
        write(&dir, "profili", "{\"a\":1}").unwrap();
        assert_eq!(read(&dir, "profili").unwrap().as_deref(), Some("{\"a\":1}"));
        assert!(write(&dir, "../x", "no").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reliquiario_solo_identi_js_in_una_cartella_assoluta() {
        let dir = std::env::temp_dir().join(format!("nebbie-reliquiario-{}", std::process::id()));
        let d = dir.to_str().unwrap();
        assert_eq!(read_relics(d).unwrap(), None);
        write_relics(d, "window.MUD_DB = {};\n").unwrap();
        assert!(dir.join("identi.js").exists());
        assert_eq!(read_relics(d).unwrap().as_deref(), Some("window.MUD_DB = {};\n"));
        assert!(write_relics("relativa", "x").is_err());
        assert!(read_relics("").is_err());
        assert_eq!(read_mobs(d).unwrap(), None);
        fs::write(dir.join("mob.js"), "window.MUD_MOB = {};\n").unwrap();
        assert_eq!(read_mobs(d).unwrap().as_deref(), Some("window.MUD_MOB = {};\n"));
        assert!(read_mobs("relativa").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
