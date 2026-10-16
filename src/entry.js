import { createIcons, icons } from "lucide";
import "./cloud/runtime.js";
window.lucide = {
  createIcons: (options = {}) => createIcons({ icons, ...options }),
};
