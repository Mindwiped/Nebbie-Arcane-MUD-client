//! Password dell'account MUD nel portachiavi del sistema (Portachiavi su macOS,
//! Gestione credenziali su Windows). La password non passa mai dal frontend dopo il
//! salvataggio e non viene mai scritta su file o nei log: il backend la legge solo per
//! mandarla al server.

use keyring::{Entry, Error};

const SERVICE: &str = "io.github.mindwiped.nebbie-client";

/// Chiave della voce nel portachiavi: `utente@host`.
pub fn account_key(host: &str, user: &str) -> String {
    format!("{}@{}", user.trim(), host.trim().to_lowercase())
}

fn entry(host: &str, user: &str) -> Result<Entry, String> {
    if user.trim().is_empty() || host.trim().is_empty() {
        return Err("Server e nome utente sono obbligatori.".into());
    }
    Entry::new(SERVICE, &account_key(host, user)).map_err(describe)
}

pub fn save(host: &str, user: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        return Err("La password è vuota.".into());
    }
    entry(host, user)?.set_password(password).map_err(describe)
}

pub fn delete(host: &str, user: &str) -> Result<(), String> {
    match entry(host, user)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(describe(e)),
    }
}

pub fn get(host: &str, user: &str) -> Result<Option<String>, String> {
    match entry(host, user)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(describe(e)),
    }
}

pub fn exists(host: &str, user: &str) -> Result<bool, String> {
    Ok(get(host, user)?.is_some())
}

fn describe(e: Error) -> String {
    format!("Portachiavi: {e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chiave_della_voce() {
        assert_eq!(
            account_key(" Nebbie.Nebbie.it ", " pg "),
            "pg@nebbie.nebbie.it"
        );
    }

    #[test]
    fn campi_obbligatori() {
        assert!(save("", "pg", "x").is_err());
        assert!(save("host", " ", "x").is_err());
        assert!(save("host", "pg", "").is_err());
    }
}
