/**
 * Detects actual HTML media playback in the current document.
 *
 * This script never sends URL or media metadata. It reports only a boolean to
 * the local extension worker. The worker forwards it with the existing active
 * tab heartbeat, and the native app accepts it only for a fresh, foreground
 * browser heartbeat.
 */
(() => {
  let lastState = null;
  let pulseId = null;

  function isMediaPlaying() {
    if (document.visibilityState !== "visible") return false;
    return Array.from(document.querySelectorAll("video, audio")).some(
      (media) => !media.paused && !media.ended && media.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA,
    );
  }

  function sendState(force = false) {
    const playing = isMediaPlaying();
    if (!force && playing === lastState) return;
    lastState = playing;
    chrome.runtime.sendMessage({ type: "media-state", playing });

    if (playing && pulseId === null) {
      // Пока медиа играет, обновляем heartbeat чаще TTL backend-а.
      pulseId = window.setInterval(() => sendState(true), 5_000);
    } else if (!playing && pulseId !== null) {
      window.clearInterval(pulseId);
      pulseId = null;
    }
  }

  for (const eventName of ["play", "playing", "pause", "ended", "emptied", "ratechange", "waiting"]) {
    document.addEventListener(eventName, () => sendState(), true);
  }
  document.addEventListener("visibilitychange", () => sendState(), true);

  new MutationObserver(() => {
    if (lastState !== true) sendState();
  }).observe(document, { childList: true, subtree: true });

  sendState(true);
})();
