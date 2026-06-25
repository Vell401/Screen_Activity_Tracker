// Предотвращает появление консольного окна на Windows в release-сборках.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    screen_activity_tracker_lib::run()
}
