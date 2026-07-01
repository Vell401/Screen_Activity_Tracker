fn main() {
    // tauri_build не отслеживает содержимое icon.ico как зависимость сборки:
    // без этой строки Cargo может не перелинковать exe с новым иконку-ресурсом
    // после замены файла (кэш build-скрипта решает, что пересобирать не надо).
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
