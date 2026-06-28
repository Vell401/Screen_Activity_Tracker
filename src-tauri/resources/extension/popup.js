document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ cmd: "reconnect" }, () => {
    const btn = document.getElementById("reconnect");
    btn.textContent = "Готово ✓";
    setTimeout(() => (btn.textContent = "Переподключить"), 1500);
  });
});
