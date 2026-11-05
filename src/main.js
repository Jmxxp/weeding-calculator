import { mountFamilyAccess } from "./family-access.js";
import { supabaseConfig } from "./config.js";

mountFamilyAccess(document.getElementById("root"), supabaseConfig);
