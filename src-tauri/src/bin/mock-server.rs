//! Finto server telnet per provare il client senza collegarsi al MUD vero.
//!
//! Uso:
//!   cargo run --bin mock-server -- <file.log> [--porta 4001] [--ga] [--fine-prompt ">>"]
//!
//! Ascolta solo su 127.0.0.1. Alla connessione manda il primo blocco del log, poi un blocco
//! per ogni comando ricevuto (qualunque sia il comando). Con `--ga` aggiunge IAC GA dopo
//! ogni blocco, come un server che segnala la fine del prompt.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::process::ExitCode;

use nebbie_client_lib::decode::{Decoder, Encoding};
use nebbie_client_lib::telnet::{GA, IAC};
use nebbie_client_lib::{mock, session_log};

struct Options {
    file: String,
    port: u16,
    ga: bool,
    prompt_end: String,
}

fn parse_options() -> Result<Options, String> {
    let mut args = std::env::args().skip(1);
    let mut opts = Options {
        file: String::new(),
        port: 4001,
        ga: false,
        prompt_end: ">>".into(),
    };
    while let Some(a) = args.next() {
        match a.as_str() {
            "--porta" => {
                opts.port = args
                    .next()
                    .and_then(|p| p.parse().ok())
                    .ok_or("--porta vuole un numero")?;
            }
            "--ga" => opts.ga = true,
            "--fine-prompt" => {
                opts.prompt_end = args.next().ok_or("--fine-prompt vuole un testo")?
            }
            "-h" | "--help" => return Err(String::new()),
            f if !f.starts_with("--") && opts.file.is_empty() => opts.file = f.to_string(),
            other => return Err(format!("opzione sconosciuta: {other}")),
        }
    }
    if opts.file.is_empty() {
        return Err("manca il file di log".into());
    }
    Ok(opts)
}

fn main() -> ExitCode {
    let opts = match parse_options() {
        Ok(o) => o,
        Err(e) => {
            if !e.is_empty() {
                eprintln!("Errore: {e}");
            }
            eprintln!("Uso: mock-server <file.log> [--porta 4001] [--ga] [--fine-prompt \">>\"]");
            return ExitCode::FAILURE;
        }
    };
    let bytes = match std::fs::read(&opts.file) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("Impossibile leggere {}: {e}", opts.file);
            return ExitCode::FAILURE;
        }
    };
    let mut decoder = Decoder::new(Encoding::Utf8);
    let mut text = decoder.decode(&bytes);
    text.push_str(&decoder.flush());
    let chunks = mock::chunks(&session_log::parse(&text), &opts.prompt_end);

    let listener = match TcpListener::bind(("127.0.0.1", opts.port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Impossibile ascoltare sulla porta {}: {e}", opts.port);
            return ExitCode::FAILURE;
        }
    };
    println!(
        "mock-server: {} ({} blocchi) su 127.0.0.1:{}. Ctrl-C per uscire.",
        opts.file,
        chunks.len(),
        opts.port
    );
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                println!("Client collegato.");
                if let Err(e) = serve(s, &chunks, opts.ga) {
                    println!("Client scollegato ({e}).");
                } else {
                    println!("Client scollegato.");
                }
            }
            Err(e) => eprintln!("Connessione rifiutata: {e}"),
        }
    }
    ExitCode::SUCCESS
}

fn serve(stream: TcpStream, chunks: &[String], ga: bool) -> std::io::Result<()> {
    let mut out = stream.try_clone()?;
    let send = |out: &mut TcpStream, chunk: &str| -> std::io::Result<()> {
        out.write_all(chunk.as_bytes())?;
        if ga {
            out.write_all(&[IAC, GA])?;
        }
        out.flush()
    };
    let mut next = 0;
    if let Some(first) = chunks.first() {
        send(&mut out, first)?;
        next = 1;
    }
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        let command = strip_telnet(&line);
        println!("  comando: {}", command.trim_end());
        if next >= chunks.len() {
            send(
                &mut out,
                "\r\n[mock-server] Fine del log: il prossimo comando ricomincia da capo.\r\n",
            )?;
            next = 0;
        } else {
            send(&mut out, &chunks[next])?;
            next += 1;
        }
    }
}

/// Toglie le negoziazioni telnet (IAC + 2 byte) che il client può mandare.
fn strip_telnet(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == IAC {
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
