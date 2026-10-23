import { mountApp } from "./app.js";
import { prepareFreshStart } from "./lib/storage.js";
prepareFreshStart();
mountApp(document.getElementById("root"));
