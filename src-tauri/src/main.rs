// Evita la finestra di console aggiuntiva su Windows in release: NON TOGLIERE.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nebbie_client_lib::run();
}
