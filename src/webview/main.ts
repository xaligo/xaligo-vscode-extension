import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "../../media/preview.css";
import { createApp } from "vue";
import ElementPlus from "element-plus";
import App from "./App.vue";

function syncColorScheme(): void {
  const isDark = document.body.classList.contains("vscode-dark")
    || document.body.classList.contains("vscode-high-contrast");
  document.documentElement.classList.toggle("dark", isDark);
}

syncColorScheme();
new MutationObserver(syncColorScheme).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"]
});

const app = createApp(App);
app.use(ElementPlus);
app.mount("#app");
