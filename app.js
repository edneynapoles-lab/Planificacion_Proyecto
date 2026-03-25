const DEFAULT_HOURS_PER_PERSON_PER_DAY = 8;
const STORAGE_REMINDERS_KEY = "gantt_sc_reminders_v1";

const TASKS = [
  { id: "t1", name: "Desarrollo de la solicitud de Cambio", colorA: "rgba(47,128,255,.72)", colorB: "rgba(34,195,238,.26)" },
  { id: "t2", name: "Instalación en QA GEOCOM",             colorA: "rgba(34,195,238,.60)", colorB: "rgba(34,195,238,.24)" },
  { id: "t3", name: "Testing de la Solicitud de Cambio",     colorA: "rgba(255,183,3,.55)",  colorB: "rgba(255,183,3,.18)" },
  { id: "t4", name: "Subida a bucket de Femsa",              colorA: "rgba(59,130,246,.55)", colorB: "rgba(59,130,246,.20)" },
  { id: "t5", name: "Liberación a Certificación Chile",      colorA: "rgba(225,29,72,.55)",  colorB: "rgba(225,29,72,.18)" },
];

const elBody = document.getElementById("taskTableBody");
const elError = document.getElementById("errorBox");
const elGantt = document.getElementById("gantt");
const elDesc = document.getElementById("sc_desc");
const elHoursPerDay = document.getElementById("hoursPerDay");

const kpiHours = document.getElementById("kpiHours");
const kpiRange = document.getElementById("kpiRange");
const kpiTotalDays = document.getElementById("kpiTotalDays");
const kpiLongest = document.getElementById("kpiLongest");
const kpiLongestSub = document.getElementById("kpiLongestSub");

const elModal = document.getElementById("chartModal");
const btnCloseModal = document.getElementById("btnCloseModal");

let fpInstances = [];
let chartDays = null;
let chartDaysBig = null;

/* ===== Utils ===== */
function pad2(n){ return String(n).padStart(2, "0"); }
function fmtDate(d){ return d ? `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}` : "—"; }
function toISODate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISODate(s){
  if(!s) return null;
  const [y,m,dd] = s.split("-").map(Number);
  if(!y || !m || !dd) return null;
  return new Date(y, m-1, dd, 12, 0, 0);
}
function startOfDayLocal(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
}
function isWeekend(date){
  const day = date.getDay();
  return day === 0 || day === 6;
}
function addDays(date, n){
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
function normalizeToBusinessDay(date){
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  while(isWeekend(d)) d = addDays(d, 1);
  return d;
}
function nextBusinessDay(date){
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  do { d = addDays(d, 1); } while(isWeekend(d));
  return d;
}
function businessDaysInclusive(a, b){
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12, 0, 0);
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12, 0, 0);
  if(A > B) return 0;
  let count = 0;
  for(let d = new Date(A); d <= B; d = addDays(d, 1)){
    if(!isWeekend(d)) count++;
  }
  return count;
}
function businessDayOffset(min, target){
  const days = businessDaysInclusive(min, target);
  return Math.max(0, days - 1);
}
function addBusinessDays(date, n){
  let d = normalizeToBusinessDay(date);
  let remaining = n;
  while(remaining > 0){
    d = addDays(d, 1);
    if(!isWeekend(d)) remaining--;
  }
  return d;
}
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function showError(msg){ elError.textContent = msg; elError.classList.add("show"); }
function clearError(){ elError.textContent = ""; elError.classList.remove("show"); }

function getHoursPerDay(){
  const raw = (elHoursPerDay?.value || "").trim().replace(",", ".");
  const v = raw === "" ? DEFAULT_HOURS_PER_PERSON_PER_DAY : Number(raw);
  if(Number.isNaN(v) || v <= 0) throw new Error('Horas por día debe ser un número válido (> 0).');
  return v;
}

/* ===== Reset ===== */
function resetUI(){
  clearError();

  elDesc.value = "";
  elHoursPerDay.value = String(DEFAULT_HOURS_PER_PERSON_PER_DAY);

  TASKS.forEach(t => {
    document.getElementById(`${t.id}_hours`).value = "";
    document.getElementById(`${t.id}_res`).value = "1";
    const s = document.getElementById(`${t.id}_start`);
    const e = document.getElementById(`${t.id}_end`);
    if(s) s.value = "";
    if(e) e.value = "";
  });

  fpInstances.forEach(fp => { try { fp.clear(); } catch(_) {} });

  elGantt.innerHTML = "";

  if(chartDays) chartDays.destroy();
  if(chartDaysBig) chartDaysBig.destroy();
  chartDays = null;
  chartDaysBig = null;

  kpiHours.textContent = "—";
  kpiRange.textContent = "—";
  kpiTotalDays.textContent = "—";
  kpiLongest.textContent = "—";
  kpiLongestSub.textContent = "—";
}

/* ===== Inputs ===== */
function renderInputs(){
  elBody.innerHTML = "";
  fpInstances.forEach(fp => fp.destroy && fp.destroy());
  fpInstances = [];

  TASKS.forEach((t, idx) => {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.innerHTML = `
      <div class="task-name">
        <span class="dot" style="background:${t.colorA}; box-shadow:0 0 0 3px ${t.colorB};"></span>
        <div>
          <div style="font-weight:900; font-size:12px;">${t.name}</div>
          <div style="color:rgba(255,255,255,.62); font-size:11px; margin-top:2px;">Fase ${idx+1}</div>
        </div>
      </div>
    `;

    const tdHours = document.createElement("td");
    tdHours.innerHTML = `<input class="input" inputmode="decimal" placeholder="Ej: 195" id="${t.id}_hours" />`;

    const tdRes = document.createElement("td");
    tdRes.innerHTML = `<input class="input" inputmode="numeric" placeholder="1" value="1" id="${t.id}_res" />`;

    const tdStart = document.createElement("td");
    const tdEnd = document.createElement("td");

    if(t.id === "t1"){
      tdStart.innerHTML = `<input class="input date" placeholder="Seleccionar" id="${t.id}_start" />`;
      tdEnd.innerHTML   = `<input class="input" readonly placeholder="Auto" id="${t.id}_end" />`;
    }else{
      tdStart.innerHTML = `<input class="input" readonly placeholder="Auto" id="${t.id}_start" />`;
      tdEnd.innerHTML   = `<input class="input" readonly placeholder="Auto" id="${t.id}_end" />`;
    }

    tr.appendChild(tdName);
    tr.appendChild(tdHours);
    tr.appendChild(tdRes);
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    elBody.appendChild(tr);
  });

  const inp = document.getElementById("t1_start");
  const fp = flatpickr(inp, {
    dateFormat: "Y-m-d",
    allowInput: true,
    disableMobile: true,
    disable: [(date) => (date.getDay() === 0 || date.getDay() === 6)]
  });
  fpInstances.push(fp);
}

/* ===== Scheduling ===== */
function scheduleByCapacity(currentDate, usedFraction, hours, resources){
  if(hours <= 0) return { startDate:null, endDate:null, nextDate: currentDate, nextUsedFraction: usedFraction };

  const res = Math.max(1, Math.floor(resources));
  const dayCapacityHours = getHoursPerDay() * res;

  let remainingFrac = hours / dayCapacityHours;

  let date = normalizeToBusinessDay(currentDate);
  let used = usedFraction;

  const startDate = date;
  let endDate = date;

  while(remainingFrac > 1e-9){
    if(isWeekend(date)){
      date = normalizeToBusinessDay(date);
      used = 0;
    }

    const capacityLeftFrac = 1 - used;

    if(remainingFrac <= capacityLeftFrac + 1e-12){
      used = used + remainingFrac;
      remainingFrac = 0;
      endDate = date;
    } else {
      remainingFrac -= capacityLeftFrac;
      used = 1;
      endDate = date;

      date = nextBusinessDay(date);
      used = 0;
    }
  }

  let nextDate = endDate;
  let nextUsed = used;

  if(nextUsed >= 1 - 1e-12){
    nextDate = nextBusinessDay(endDate);
    nextUsed = 0;
  }

  return { startDate, endDate, nextDate, nextUsedFraction: nextUsed };
}

function readAndComputeTasks(){
  const desc = (elDesc.value || "").trim();
  if(!desc) throw new Error('Debes ingresar la "Descripción de la Solicitud de Cambio".');

  getHoursPerDay();

  const tasks = TASKS.map(t => {
    const hoursRaw = document.getElementById(`${t.id}_hours`).value.trim();
    const resRaw = document.getElementById(`${t.id}_res`).value.trim();

    const hours = hoursRaw === "" ? 0 : Number(hoursRaw.replace(",", "."));
    const resources = resRaw === "" ? 1 : Number(resRaw);

    if(Number.isNaN(hours) || hours < 0) throw new Error(`En "${t.name}" las horas deben ser un número válido (>= 0).`);
    if(Number.isNaN(resources) || resources < 1) throw new Error(`En "${t.name}" recursos debe ser >= 1.`);

    return { ...t, hours, resources: Math.floor(resources) };
  });

  const startDevRaw = (document.getElementById("t1_start").value || "").trim();
  const startDev = parseISODate(startDevRaw);
  if(!startDev) throw new Error('Debes seleccionar la "Fecha inicio" del Desarrollo.');

  if(tasks[0].hours <= 0) throw new Error('Debes ingresar "Horas" (>0) para el Desarrollo.');

  let currentDate = normalizeToBusinessDay(startDev);
  let usedFraction = 0;

  for(const t of tasks){
    if(t.hours <= 0){
      t.start = null; t.end = null;
      continue;
    }

    const sch = scheduleByCapacity(currentDate, usedFraction, t.hours, t.resources);
    t.start = sch.startDate;
    t.end = sch.endDate;

    currentDate = sch.nextDate;
    usedFraction = sch.nextUsedFraction;
  }

  document.getElementById("t1_end").value = tasks[0].end ? toISODate(tasks[0].end) : "";
  for(let i=1;i<tasks.length;i++){
    const t = tasks[i];
    document.getElementById(`${t.id}_start`).value = t.start ? toISODate(t.start) : "";
    document.getElementById(`${t.id}_end`).value   = t.end   ? toISODate(t.end)   : "";
  }

  return { desc, tasks };
}

/* ===== Gantt ===== */
function renderGantt(desc, tasks){
  const withDates = tasks.filter(t => t.start && t.end);
  if(withDates.length === 0) throw new Error("No hay fases con fechas para dibujar.");

  const min = withDates.reduce((a,t) => t.start < a ? t.start : a, withDates[0].start);
  const max = withDates.reduce((a,t) => t.end   > a ? t.end   : a, withDates[0].end);

  const totalBizDays = businessDaysInclusive(min, max);
  if(totalBizDays <= 0) throw new Error("El rango calculado no tiene días hábiles.");

  const TICKS = 8;

  const header = document.createElement("div");
  header.className = "gantt-header";

  const colLeft = document.createElement("div");
  colLeft.className = "col-left";
  colLeft.innerHTML = `
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
      <div style="font-weight:900; color:rgba(255,255,255,.86);">Fase</div>
      <div style="color:rgba(255,255,255,.62); font-size:10.5px;">Rango: ${fmtDate(min)} → ${fmtDate(max)}</div>
    </div>
    <div style="color:rgba(255,255,255,.82); font-size:11px; line-height:1.2;">
      <div style="color:rgba(255,255,255,.62); font-weight:900; letter-spacing:.15px; margin-bottom:3px;">Descripción</div>
      <div style="white-space:normal;">${escapeHtml(desc)}</div>
    </div>
  `;

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  const ticks = document.createElement("div");
  ticks.className = "ticks";

  for(let i=0;i<TICKS;i++){
    const tick = document.createElement("div");
    tick.className = "tick";
    const ratio = (TICKS === 1) ? 0 : i/(TICKS-1);
    const bizOffset = Math.round((totalBizDays-1) * ratio);

    let d = new Date(min.getFullYear(), min.getMonth(), min.getDate(), 12, 0, 0);
    let seen = 0;
    while(seen < bizOffset){
      d = addDays(d, 1);
      if(!isWeekend(d)) seen++;
    }
    tick.textContent = fmtDate(d);
    ticks.appendChild(tick);
  }
  timeline.appendChild(ticks);

  header.appendChild(colLeft);
  header.appendChild(timeline);

  const rowsFrag = document.createDocumentFragment();

  withDates.forEach(t => {
    const dBiz = businessDaysInclusive(t.start, t.end);
    const startOffsetBiz = businessDayOffset(min, t.start);
    const leftPct = (startOffsetBiz / totalBizDays) * 100;
    const widthPct = (dBiz / totalBizDays) * 100;

    const row = document.createElement("div");
    row.className = "gantt-row";

    const left = document.createElement("div");
    left.className = "left";
    left.innerHTML = `
      <div class="name">
        <span class="dot" style="background:${t.colorA}; box-shadow:0 0 0 3px ${t.colorB};"></span>
        <span>${t.name}</span>
      </div>
      <div class="meta">
        <span class="pill">📅 ${fmtDate(t.start)} → ${fmtDate(t.end)}</span>
        <span class="pill">🗓️ ${dBiz}d</span>
      </div>
    `;

    const right = document.createElement("div");
    right.className = "right";

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.left = `${clamp(leftPct, 0, 100)}%`;
    bar.style.width = `${clamp(widthPct, 0.6, 100)}%`;
    bar.style.background = `linear-gradient(90deg, ${t.colorA}, ${t.colorB})`;

    const rightLabel = document.createElement("div");
    rightLabel.className = "rightLabel";
    rightLabel.textContent = `${dBiz}d`;

    bar.appendChild(rightLabel);
    right.appendChild(bar);

    row.appendChild(left);
    row.appendChild(right);
    rowsFrag.appendChild(row);
  });

  elGantt.innerHTML = "";
  elGantt.appendChild(header);
  elGantt.appendChild(rowsFrag);

  return { min, max, totalBizDays };
}

/* ===== Charts ===== */
function updateKPIsAndCharts(tasks, rangeInfo){
  const withDates = tasks.filter(t => t.start && t.end);

  const totalHours = tasks.reduce((sum,t)=> sum + (t.hours || 0), 0);
  kpiHours.textContent = totalHours ? `${String(totalHours).replace(/\.0$/, "")} h` : "—";
  kpiRange.textContent = `${fmtDate(rangeInfo.min)} → ${fmtDate(rangeInfo.max)}`;
  kpiTotalDays.textContent = `${rangeInfo.totalBizDays} d`;

  let longest = null;
  for(const t of withDates){
    const d = businessDaysInclusive(t.start, t.end);
    if(!longest || d > longest.days) longest = { name: t.name, days: d };
  }
  kpiLongest.textContent = longest ? `${longest.days} d` : "—";
  kpiLongestSub.textContent = longest ? longest.name : "—";

  const labels = TASKS.map(t => t.name);
  const daysData  = TASKS.map(t => {
    const f = tasks.find(x=>x.id===t.id);
    return (f && f.start && f.end) ? businessDaysInclusive(f.start,f.end) : 0;
  });

  if(chartDays) chartDays.destroy();
  chartDays = new Chart(document.getElementById("chartDays"), {
    type: "doughnut",
    data: { labels, datasets: [{ label: "Días (L–V)", data: daysData, borderWidth: 1 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ position:"bottom", labels:{ color:"rgba(255,255,255,.78)", boxWidth:12, font:{size:10} } },
        tooltip:{ callbacks:{ label:(ctx)=>` ${ctx.label}: ${ctx.raw} día(s)` } }
      }
    }
  });

  if(chartDaysBig) chartDaysBig.destroy();
  chartDaysBig = new Chart(document.getElementById("chartDaysBig"), {
    type: "doughnut",
    data: { labels, datasets: [{ label: "Días (L–V)", data: daysData, borderWidth: 1 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ position:"right", labels:{ color:"rgba(255,255,255,.86)", boxWidth:14, font:{size:12} } },
        tooltip:{ callbacks:{ label:(ctx)=>` ${ctx.label}: ${ctx.raw} día(s)` } }
      }
    }
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== Save/load .ganttplan ===== */
function buildStateFromUI(){
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    hoursPerDay: (elHoursPerDay?.value || String(DEFAULT_HOURS_PER_PERSON_PER_DAY)).trim(),
    desc: (elDesc.value || "").trim(),
    tasks: TASKS.map(t => ({
      id: t.id,
      hours: (document.getElementById(`${t.id}_hours`).value || "").trim(),
      res: (document.getElementById(`${t.id}_res`).value || "").trim(),
      start: (document.getElementById(`${t.id}_start`)?.value || "").trim(),
      end: (document.getElementById(`${t.id}_end`)?.value || "").trim()
    }))
  };
}
function applyStateToUI(state){
  if(!state || !state.tasks) throw new Error("Formato de guardado inválido.");

  elDesc.value = state.desc || "";
  elHoursPerDay.value = (state.hoursPerDay || String(DEFAULT_HOURS_PER_PERSON_PER_DAY)).trim();

  for(const row of state.tasks){
    const t = TASKS.find(x => x.id === row.id);
    if(!t) continue;

    document.getElementById(`${t.id}_hours`).value = row.hours ?? "";
    document.getElementById(`${t.id}_res`).value = row.res ?? "1";

    const s = document.getElementById(`${t.id}_start`);
    const e = document.getElementById(`${t.id}_end`);
    if(s) s.value = row.start ?? "";
    if(e) e.value = row.end ?? "";

    if(t.id === "t1" && fpInstances[0] && row.start){
      try { fpInstances[0].setDate(row.start, true, "Y-m-d"); } catch(_) {}
    }
  }
}
function encodePlan(state){
  const json = JSON.stringify(state);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return "GANTTPLANv1:" + b64;
}
function decodePlan(text){
  if(!text || !text.startsWith("GANTTPLANv1:")) throw new Error("Archivo inválido o versión no soportada.");
  const b64 = text.slice("GANTTPLANv1:".length);
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json);
}
function downloadTextFile(filename, text){
  const blob = new Blob([text], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function slugifyFilename(input, maxLen = 70){
  const s = String(input || "").trim();
  if(!s) return "sin_descripcion";
  let out = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  out = out.replace(/[^a-zA-Z0-9 _-]+/g, " ");
  out = out.trim().replace(/\s+/g, "_");
  out = out.replace(/_+/g, "_").replace(/-+/g, "-");
  if(out.length > maxLen) out = out.slice(0, maxLen).replace(/[_-]+$/g, "");
  return out || "sin_descripcion";
}

/* ===== Email ===== */
function buildEmailBodyWanted(desc, tasks, rangeInfo){
  const lines = [];

  lines.push("DESCRIPCIÓN:");
  lines.push(desc);
  lines.push("");

  lines.push("FECHA DE INICIO Y FIN: " + `${fmtDate(rangeInfo.min)} -> ${fmtDate(rangeInfo.max)}`);
  lines.push("DURACIÓN TOTAL (L-V): " + `${rangeInfo.totalBizDays} día(s)`);
  lines.push("FASES:");

  for(const t of tasks){
    if(!t.start || !t.end) continue;
    const dBiz = businessDaysInclusive(t.start, t.end);
    lines.push(`- ${t.name}: ${fmtDate(t.start)} -> ${fmtDate(t.end)} (${dBiz} día(s))`);
  }

  return lines.join("\n");
}
function openMailClient(subject, body){
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}

/* ===== Modal ===== */
function openModal(){
  elModal.classList.add("show");
  elModal.setAttribute("aria-hidden", "false");
}
function closeModal(){
  elModal.classList.remove("show");
  elModal.setAttribute("aria-hidden", "true");
}

/* ===== Recordatorios A + B ===== */
function shortenDesc(desc, maxLen = 50){
  const s = String(desc || "").trim().replace(/\s+/g, " ");
  if(s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function computeReminders(desc, tasks, rangeInfo){
  const short = shortenDesc(desc, 50);

  const t1 = tasks.find(t => t.id === "t1");
  const t2 = tasks.find(t => t.id === "t2");
  const t3 = tasks.find(t => t.id === "t3");

  const reminders = [];

  // 1) Mitad desarrollo
  if(t1?.start && t1?.end){
    const t1Days = businessDaysInclusive(t1.start, t1.end);
    const halfOffset = Math.max(0, Math.floor((t1Days - 1) / 2));
    const halfDate = addBusinessDays(t1.start, halfOffset);
    reminders.push({
      id: "half_dev",
      title: `SC - MITAD DEV - ${short}`,
      dateISO: toISODate(halfDate),
      done: false
    });
  }

  // 2) Inicio QA (t2, fallback t3)
  let qaStart = null;
  if(t2?.start) qaStart = t2.start;
  else if(t3?.start) qaStart = t3.start;

  if(qaStart){
    reminders.push({
      id: "qa_start",
      title: `SC - INICIO QA - ${short}`,
      dateISO: toISODate(qaStart),
      done: false
    });
  }

  // 3) Inicio Testing (t3 si existe)
  if(t3?.start){
    reminders.push({
      id: "testing_start",
      title: `SC - INICIO TESTING - ${short}`,
      dateISO: toISODate(t3.start),
      done: false
    });
  }

  // 4) Fin plan (fin rango total)
  if(rangeInfo?.max){
    reminders.push({
      id: "plan_end",
      title: `SC - FIN PLAN - ${short}`,
      dateISO: toISODate(rangeInfo.max),
      done: false
    });
  }

  return reminders;
}

function loadReminders(){
  const raw = localStorage.getItem(STORAGE_REMINDERS_KEY);
  if(!raw) return [];
  try{
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  }catch{
    return [];
  }
}
function saveReminders(reminders){
  localStorage.setItem(STORAGE_REMINDERS_KEY, JSON.stringify(reminders));
}
function mergeReminders(newReminders){
  const existing = loadReminders();
  const key = (r) => `${r.title}__${r.dateISO}`;
  const map = new Map(existing.map(r => [key(r), r]));
  for(const r of newReminders){
    if(!map.has(key(r))) map.set(key(r), r);
  }
  const merged = Array.from(map.values());
  saveReminders(merged);
  return merged;
}
function listPendingReminders(reminders){
  const today = startOfDayLocal(new Date());
  return reminders
    .filter(r => !r.done)
    .filter(r => {
      const d = parseISODate(r.dateISO);
      if(!d) return false;
      return startOfDayLocal(d) <= today;
    });
}
function showPendingRemindersIfAny(){
  const reminders = loadReminders();
  const pending = listPendingReminders(reminders);
  if(pending.length === 0) return;

  const msgLines = [
    "RECORDATORIOS PENDIENTES:",
    "",
    ...pending.map(r => `- ${r.title} (${r.dateISO})`),
    "",
    "Tip: Importá el .ics para recibir alertas reales en el calendario."
  ];
  alert(msgLines.join("\n"));
}
function clearReminders(){
  localStorage.removeItem(STORAGE_REMINDERS_KEY);
}

/* ===== ICS (compatible Google/Outlook) ===== */
function escapeIcsText(s){
  return String(s || "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}
function buildIcs(reminders){
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth()+1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const lines = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Gantt SC//Reminders//ES");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  for(const r of reminders){
    const d = parseISODate(r.dateISO);
    if(!d) continue;

    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const day = pad2(d.getDate());
    const dtStart = `${y}${m}${day}`;

    const dEnd = addDays(d, 1);
    const y2 = dEnd.getFullYear();
    const m2 = pad2(dEnd.getMonth()+1);
    const day2 = pad2(dEnd.getDate());
    const dtEnd = `${y2}${m2}${day2}`;

    const uid = `gantt-sc-${dtStart}-${Math.random().toString(16).slice(2)}@local`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtStart}`);
    lines.push(`DTEND;VALUE=DATE:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(r.title)}`);

    // Recordatorio: 9h antes (modificable)
    lines.push("BEGIN:VALARM");
    lines.push("TRIGGER:-PT9H");
    lines.push("ACTION:DISPLAY");
    lines.push("DESCRIPTION:Recordatorio");
    lines.push("END:VALARM");

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/* ===== Eventos ===== */
document.getElementById("btnGenerate").addEventListener("click", () => {
  try{
    clearError();
    const { desc, tasks } = readAndComputeTasks();
    const rangeInfo = renderGantt(desc, tasks);
    updateKPIsAndCharts(tasks, rangeInfo);

    // Guardar recordatorios locales (A)
    const newReminders = computeReminders(desc, tasks, rangeInfo);
    mergeReminders(newReminders);
  }catch(e){
    showError(e.message || String(e));
  }
});

document.getElementById("btnClear").addEventListener("click", () => resetUI());

document.getElementById("btnDemo").addEventListener("click", () => {
  clearError();

  elDesc.value = "Ejemplo: Ajustes en validación de orden y despliegue controlado en QA.";
  elHoursPerDay.value = "8";

  document.getElementById("t1_start").value = "2026-02-02";
  if(fpInstances[0]){
    try { fpInstances[0].setDate("2026-02-02", true, "Y-m-d"); } catch(_) {}
  }

  document.getElementById("t1_hours").value = 195; document.getElementById("t1_res").value = 2;
  document.getElementById("t2_hours").value = 3;   document.getElementById("t2_res").value = 1;
  document.getElementById("t3_hours").value = 65;  document.getElementById("t3_res").value = 2;
  document.getElementById("t4_hours").value = 1;   document.getElementById("t4_res").value = 1;
  document.getElementById("t5_hours").value = 1;   document.getElementById("t5_res").value = 1;

  document.getElementById("btnGenerate").click();
});

document.getElementById("btnSaveFile").addEventListener("click", () => {
  try{
    clearError();

    const state = buildStateFromUI();
    if(!state.desc) throw new Error('Debes completar "Descripción" antes de guardar.');
    getHoursPerDay();

    const payload = encodePlan(state);

    const date = new Date();
    const descSlug = slugifyFilename(state.desc, 70);
    const timestamp = `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}`;
    const filename = `${descSlug}_${timestamp}.ganttplan`;

    downloadTextFile(filename, payload);

    resetUI();
    showError(`Archivo guardado (${filename}). Se limpió el formulario.`);
  }catch(e){
    showError(e.message || String(e));
  }
});

document.getElementById("btnLoadFile").addEventListener("click", () => {
  try{
    clearError();
    document.getElementById("filePicker").click();
  }catch(e){
    showError(e.message || String(e));
  }
});

document.getElementById("filePicker").addEventListener("change", async (ev) => {
  try{
    clearError();
    const file = ev.target.files?.[0];
    if(!file) return;

    const text = await file.text();
    const state = decodePlan(text);
    applyStateToUI(state);

    document.getElementById("btnGenerate").click();
  }catch(e){
    showError(e.message || String(e));
  }finally{
    ev.target.value = "";
  }
});

document.getElementById("btnEmail").addEventListener("click", () => {
  try{
    clearError();

    const { desc, tasks } = readAndComputeTasks();
    const rangeInfo = renderGantt(desc, tasks);
    updateKPIsAndCharts(tasks, rangeInfo);

    const subject = `Solicitud de Cambio - Gantt (${fmtDate(rangeInfo.min)} -> ${fmtDate(rangeInfo.max)})`;
    const body = buildEmailBodyWanted(desc, tasks, rangeInfo);
    openMailClient(subject, body);
  }catch(e){
    showError(e.message || String(e));
  }
});

document.getElementById("chartDays").addEventListener("click", () => {
  if(!chartDaysBig) return;
  openModal();
});
btnCloseModal.addEventListener("click", closeModal);
elModal.addEventListener("click", (ev) => { if(ev.target === elModal) closeModal(); });
document.addEventListener("keydown", (ev) => { if(ev.key === "Escape") closeModal(); });

document.getElementById("btnRemindersIcs").addEventListener("click", () => {
  try{
    clearError();

    // aseguramos plan calculado
    const { desc, tasks } = readAndComputeTasks();
    const rangeInfo = renderGantt(desc, tasks);

    const reminders = computeReminders(desc, tasks, rangeInfo);
    if(reminders.length === 0) throw new Error("No se pudieron generar recordatorios (faltan fechas).");

    const ics = buildIcs(reminders);
    const date = new Date();
    const descSlug = slugifyFilename(desc, 50);
    const filename = `recordatorios_${descSlug}_${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}.ics`;
    downloadTextFile(filename, ics);

    // también guardamos local
    mergeReminders(reminders);

  }catch(e){
    showError(e.message || String(e));
  }
});

document.getElementById("btnRemindersClear").addEventListener("click", () => {
  clearReminders();
  showError("Recordatorios eliminados.");
});

/* Init */
renderInputs();
showPendingRemindersIfAny();