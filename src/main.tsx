import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/theme.css";
import "./components/components.css";
import "./components/charts/charts.css";
import "./views/views.css";

// Тему применяем ДО первого рендера (из localStorage-кеша), чтобы не было вспышки
// тёмного фона у пользователей со светлой темой. Источник истины — настройки в БД
// (App дочитывает их и при необходимости переключает), здесь лишь быстрый кеш.
try {
  const saved = localStorage.getItem("theme");
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
