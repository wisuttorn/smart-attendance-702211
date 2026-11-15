import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import QRCode from "https://esm.sh/qrcode@1.5.4";
import Papa from "https://esm.sh/papaparse@5.5.3";
import { supabaseUrl, publishableKey } from "./config.js";

const client = createClient(supabaseUrl, publishableKey);
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
const page = new URL(location.pathname, location.origin);
const savedDeviceKey = "sa702211_device";
let selectedCourse;
let selectedSection;

const errors = {
  FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูล",
  INVALID_ACTIVATION: "รหัสนักศึกษาหรือ Activation Code ไม่ถูกต้องหรือหมดอายุ",
  INVALID_CHECKIN: "รหัสนักศึกษา, PIN หรือกลุ่มเรียนไม่ถูกต้อง",
  INVALID_ROSTER: "ไฟล์ต้องมีรายชื่อ 1–500 แถว",
  INVALID_ROSTER_ROW: "ตรวจสอบรหัสนักศึกษาและชื่อ–นามสกุลในไฟล์",
  NOT_ELIGIBLE: "บัญชีเปิดใช้งานแล้ว หรือไม่สามารถออกรหัสได้",
  QR_EXPIRED: "QR หมดอายุ กรุณาสแกน QR ล่าสุดบนหน้าจออาจารย์",
  SCAN_AGAIN: "กรุณาสแกน QR ล่าสุดแล้วลองอีกครั้ง",
  SESSION_CLOSED: "คาบนี้ปิดเช็กชื่อแล้ว",
  STUDENT_IN_ANOTHER_SECTION: "มีรหัสนักศึกษาที่อยู่ในกลุ่มเรียนอื่น",
  TRY_AGAIN: "มีผู้ใช้งานจำนวนมาก กรุณาสแกน QR รอบถัดไป",
  TRY_AGAIN_LATER: "ลอง PIN หลายครั้งเกินไป กรุณารอ 5 นาที",
};
function status(message = "") { $("status").textContent = message; }
function report(error) {
  status(errors[error.message] ?? "ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลหรือการเชื่อมต่อแล้วลองอีกครั้ง");
}
async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
function teacher(action, id, data) {
  return rpc("sa702211_teacher", { p_action: action, p_id: id, p_data: data });
}
function student(action, data) {
  return rpc("sa702211_student", { p_action: action, p_data: data });
}
function bind(target, event, callback) {
  target.addEventListener(event, async (e) => {
    e.preventDefault();
    const button = event === "submit" ? e.submitter : target;
    if (button.disabled) return;
    button.disabled = true;
    status();
    try {
      await callback(e);
    } catch (error) {
      report(error);
    } finally {
      button.disabled = false;
      if (target === $("start") || target === $("end")) updateSessionControls();
    }
  });
}
function route(params) {
  const url = new URL(page);
  url.search = new URLSearchParams(params);
  return url;
}
function formData(form) { return Object.fromEntries(new FormData(form)); }
function show(id) { $(id).hidden = false; }

bind($("login-form"), "submit", async (event) => {
  const { error } = await client.auth.signInWithPassword(formData(event.currentTarget));
  if (error) {
    status("เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน");
    return;
  }
  location.reload();
});
bind($("logout"), "click", async () => {
  const { error } = await client.auth.signOut();
  if (error) throw error;
  location.assign(page);
});

function updateSessionControls() {
  const session = selectedSection?.session_id;
  $("start").disabled = !selectedSection || Boolean(session);
  $("end").hidden = !session;
  $("open-projector").hidden = !session;
}
async function loadRoster(section) {
  const rows = await teacher("roster", section.id);
  if (section !== selectedSection) return;
  $("roster-rows").replaceChildren(...rows.map((studentRow) => {
    const row = document.createElement("tr");
    row.insertCell().textContent = studentRow.student_code;
    row.insertCell().textContent = studentRow.full_name;
    const cell = row.insertCell();
    if (studentRow.activated) {
      cell.textContent = "เปิดใช้งานแล้ว";
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "ออก Activation Code";
      cell.append(button);
      bind(button, "click", async () => {
        const result = await teacher("issue_activation", studentRow.id);
        const code = document.createElement("code");
        code.textContent = result.code;
        cell.replaceChildren(code);
      });
    }
    return row;
  }));
}
async function changeSection(sections) {
  selectedSection = sections.find(({ id }) => id === $("section").value);
  updateSessionControls();
  $("roster").hidden = !selectedSection;
  $("roster-rows").replaceChildren();
  if (selectedSection) await loadRoster(selectedSection);
}
async function showTeacher() {
  show("teacher");
  updateSessionControls();
  const courses = await teacher("courses");
  selectedCourse = courses.find(({ code }) => code === "702211");
  if (!selectedCourse) {
    $("section").disabled = true;
    status("ยังไม่ได้กำหนดรายวิชา 702211 ให้บัญชีนี้");
    return;
  }
  const sections = selectedCourse.sections;
  $("section").replaceChildren(...sections.map((section) => new Option(section.name, section.id)));
  $("section").addEventListener("change", () => changeSection(sections).catch(report));
  $("activation-link").href = route({ activate: selectedCourse.id });
  await changeSection(sections);
}
bind($("start"), "click", async () => {
  if (!selectedSection) return;
  const section = selectedSection;
  const { id } = await teacher("start", section.id);
  section.session_id = id;
});
bind($("end"), "click", async () => {
  if (!selectedSection?.session_id || !window.confirm("ปิดการเช็กชื่อสำหรับคาบนี้?")) return;
  const section = selectedSection;
  await teacher("end", section.session_id);
  section.session_id = null;
  status("ปิดเช็กชื่อแล้ว");
});
$("open-projector").addEventListener("click", () => {
  if (selectedSection?.session_id) window.open(route({ projector: selectedSection.session_id }), "_blank", "noopener");
});
bind($("import-form"), "submit", async (event) => {
  const form = event.currentTarget;
  const section = selectedSection;
  const file = new FormData(form).get("file");
  if (!section || !file?.size || file.size > 1_000_000) throw new Error("INVALID_ROSTER");
  const parsed = Papa.parse((await file.text()).replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length || !parsed.meta.fields?.includes("student_code") || !parsed.meta.fields.includes("full_name")) {
    status("ตรวจสอบไฟล์ CSV และหัวคอลัมน์ student_code,full_name");
    return;
  }
  const rows = parsed.data.map(({ student_code, full_name }) => ({
    student_code: student_code?.trim(),
    full_name: full_name?.trim(),
  }));
  if (new Set(rows.map((row) => row.student_code)).size !== rows.length) {
    status("พบรหัสนักศึกษาซ้ำในไฟล์ กรุณาตรวจสอบก่อนอัปโหลด");
    return;
  }
  const result = await teacher("import", section.id, rows);
  form.reset();
  status(`บันทึกรายชื่อแล้ว ${result.imported} คน`);
  await loadRoster(section);
});

async function showProjector(sessionId) {
  show("projector");
  let ended = false;
  let deadline = 0;
  let timer;
  let requestVersion = 0;
  let channel;
  let tick;
  let fallback;
  const qr = $("qr");

  function closeQr() {
    ended = true;
    clearTimeout(timer);
    clearInterval(tick);
    clearInterval(fallback);
    if (channel) void client.removeChannel(channel);
    qr.hidden = true;
    $("qr-state").textContent = "ปิดเช็กชื่อแล้ว";
  }
  async function refresh() {
    const version = ++requestVersion;
    const result = await teacher("projector", sessionId);
    if (version !== requestVersion) return;
    $("success-list").replaceChildren(...result.rows.map(({ name }) => {
      const li = document.createElement("li");
      li.textContent = name;
      return li;
    }));
    $("count").textContent = result.rows.length;
    if (result.ended) closeQr();
  }
  async function rotate() {
    if (ended) return;
    try {
      const sent = performance.now();
      const result = await teacher("qr", sessionId);
      if (ended) return;
      deadline = sent + Date.parse(result.expires_at) - Date.parse(result.server_now);
      const url = new URL(page);
      url.hash = new URLSearchParams({ checkin: result.token });
      await QRCode.toCanvas(qr, url.href, { width: 432, margin: 3, errorCorrectionLevel: "M" });
      if (ended) return;
      qr.hidden = performance.now() >= deadline;
      timer = setTimeout(rotate, Math.max(175, deadline - performance.now() + 150));
    } catch (error) {
      qr.hidden = true;
      if (error.message === "SESSION_CLOSED") {
        await refresh().catch(report);
      } else {
        $("qr-state").textContent = "กำลังเชื่อมต่อ QR อีกครั้ง";
        timer = setTimeout(rotate, 2500);
      }
    }
  }
  await refresh();
  if (ended) return;
  channel = client.channel(`sa-projector-${sessionId}`)
    .on("postgres_changes", { event: "INSERT", schema: "smart_attendance", table: "attendance", filter: `session_id=eq.${sessionId}` }, () => void refresh().catch(report))
    .on("postgres_changes", { event: "UPDATE", schema: "smart_attendance", table: "checkin_sessions", filter: `id=eq.${sessionId}` }, () => void refresh().catch(report))
    .subscribe((state) => {
      if (state === "SUBSCRIBED") void refresh().catch(report);
    });
  fallback = setInterval(() => void refresh().catch(report), 8000);
  tick = setInterval(() => {
    const remain = Math.ceil((deadline - performance.now()) / 1000);
    if (remain <= 0) qr.hidden = true;
    if (!qr.hidden) $("qr-state").textContent = `เปลี่ยน QR ใน ${remain} วินาที`;
  }, 150);
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    clearInterval(tick);
    clearInterval(fallback);
    void client.removeChannel(channel);
  }, { once: true });
  await rotate();
}

bind($("activate-form"), "submit", async (event) => {
  await student("activate", { ...formData(event.currentTarget), course_id: query.get("activate") });
  $("activate-form").hidden = true;
  status("เปิดใช้งานบัญชีแล้ว สแกน QR จากอาจารย์เมื่อเริ่มเช็กชื่อ");
});
function getDevice() {
  try { return JSON.parse(localStorage.getItem(savedDeviceKey)); }
  catch { return null; }
}
async function showCheckin(token) {
  show("checkin");
  const ticket = await student("redeem", { token });
  const form = $("checkin-form");
  const device = getDevice();
  if (device?.course === ticket.course_id) {
    form.elements.student_code.value = device.code;
    form.elements.pin.placeholder = "เว้นว่างได้หากเคยจดจำอุปกรณ์นี้";
  }
  form.elements.pin.required = device?.course !== ticket.course_id;
  form.hidden = false;
  bind(form, "submit", async () => {
    const input = formData(form);
    const code = input.student_code.trim();
    const result = await student("checkin", {
      ...ticket,
      student_code: code,
      pin: input.pin,
      remember: Boolean(input.remember),
      device_token: !input.pin && device?.course === ticket.course_id && device.code === code ? device.token : null,
    });
    if (result.device_token) {
      try {
        localStorage.setItem(savedDeviceKey, JSON.stringify({ course: ticket.course_id, code, token: result.device_token }));
      } catch { /* The attendance record is already saved. */ }
    }
    form.hidden = true;
    status(result.already_checked_in ? "คุณเช็กชื่อคาบนี้แล้ว" : "เช็กชื่อสำเร็จ");
  });
}
async function main() {
  if (fragment.has("checkin")) {
    const token = fragment.get("checkin");
    history.replaceState(null, "", page);
    await showCheckin(token);
  } else if (query.has("activate")) {
    show("activate");
  } else if (query.has("teacher") || query.has("projector")) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) show("login");
    else if (query.has("projector")) await showProjector(query.get("projector"));
    else await showTeacher();
  } else {
    show("home");
  }
}
main().catch(report);
