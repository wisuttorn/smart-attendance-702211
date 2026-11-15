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
const teacherView = ["accounts", "students"].includes(query.get("view")) ? query.get("view") : "attendance";
const teacherTitles = { attendance: "เช็คชื่อ", accounts: "บัญชีนักศึกษา", students: "เพิ่มนักศึกษา" };
const issuedCodesBySection = new Map();
const thaiDateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

const errors = {
  INVALID_RESET: "รหัสนักศึกษาหรือรหัสรีเซ็ตไม่ถูกต้อง หรือรหัสหมดอายุแล้ว",
  STUDENT_ALREADY_EXISTS: "รหัสนักศึกษานี้มีอยู่ในรายวิชาแล้ว",
  FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูล",
  INVALID_ACTIVATION: "รหัสนักศึกษาหรือ Activation Code ไม่ถูกต้องหรือหมดอายุ",
  INVALID_CHECKIN: "รหัสนักศึกษา, PIN หรือตอนเรียนไม่ถูกต้อง",
  INVALID_ROSTER: "ไฟล์ต้องมีรายชื่อ 1–500 แถว",
  INVALID_ROSTER_ROW: "ตรวจสอบรหัสนักศึกษาและชื่อ–นามสกุลในไฟล์",
  NOT_ELIGIBLE: "บัญชีเปิดใช้งานแล้ว หรือไม่สามารถออกรหัสได้",
  QR_EXPIRED: "QR หมดอายุ กรุณาสแกน QR ล่าสุดบนหน้าจออาจารย์",
  SCAN_AGAIN: "กรุณาสแกน QR ล่าสุดแล้วลองอีกครั้ง",
  SESSION_CLOSED: "คาบนี้ปิดเช็คชื่อแล้ว",
  STUDENT_IN_ANOTHER_SECTION: "มีรหัสนักศึกษาที่อยู่ในตอนเรียนอื่น",
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
      if (target === $("teacher-reset-form")) $("issue-reset").disabled = !$("reset-student").value;
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
function updateTeacherNav(active, sectionId) {
  const routes = {
    attendance: {},
    accounts: { view: "accounts" },
    students: { view: "students" },
    report: { report: "" },
  };
  for (const [name, params] of Object.entries(routes)) {
    const link = $("nav-" + name);
    link.href = route({ teacher: "", ...params, ...(sectionId ? { section: sectionId } : {}) });
    if (name === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  show("teacher-nav");
}

async function loadResetOptions(section) {
  const rows = await teacher("roster", section.id);
  if (section !== selectedSection) return;
  const options = rows.filter(({ activated }) => activated)
    .map(({ id, student_code, full_name }) => new Option(student_code + " · " + full_name, id));
  $("reset-student").replaceChildren(new Option("เลือกนักศึกษา", ""), ...options);
}

async function changeSection(sections) {
  selectedSection = sections.find(({ id }) => id === $("section").value);
  updateTeacherNav(teacherView, selectedSection?.id);
  updateSessionControls();
  $("student-tools").hidden = teacherView !== "students" || !selectedSection;
  $("teacher-accounts").hidden = teacherView !== "accounts" || !selectedSection;
  if (teacherView !== "accounts" || !selectedSection) return;
  $("reset-student").replaceChildren(new Option("เลือกนักศึกษา", ""));
  $("issue-reset").disabled = true;
  $("teacher-reset-result").hidden = true;
  $("reset-code").textContent = "";
  $("issue-activation-section").disabled = false;
  renderActivationCodes(selectedSection);
  updateActivationQr();
  await loadResetOptions(selectedSection);
}

async function showTeacher() {
  show("teacher");
  updateTeacherNav(teacherView);
  $("teacher-heading").textContent = teacherTitles[teacherView];
  $("session-actions").hidden = teacherView !== "attendance";
  updateSessionControls();
  const courses = await teacher("courses");
  selectedCourse = courses.find(({ code }) => code === "702211");
  const sections = selectedCourse?.sections ?? [];
  if (!sections.length) {
    $("section").disabled = true;
    status("ยังไม่มีตอนเรียนสำหรับบัญชีนี้");
    return;
  }
  $("section").replaceChildren(...sections.map(({ id, name }) => new Option(name, id)));
  const requested = query.get("section");
  if (sections.some(({ id }) => id === requested)) $("section").value = requested;
  $("section").addEventListener("change", () => changeSection(sections).catch(report));
  $("activation-qr-panel").addEventListener("toggle", updateActivationQr);
  $("activation-link").href = route({ activate: selectedCourse.id });
  $("reset-link").href = route({ reset: selectedCourse.id });
  await changeSection(sections);
}
$("reset-student").addEventListener("change", () => {
  $("issue-reset").disabled = !$("reset-student").value;
  $("teacher-reset-result").hidden = true;
  $("reset-code").textContent = "";
});
bind($("teacher-reset-form"), "submit", async () => {
  const studentId = $("reset-student").value;
  const recipient = $("reset-student").selectedOptions[0]?.text;
  const section = selectedSection;
  if (!studentId) return;
  const result = await rpc("sa702211_issue_pin_reset", { p_student: studentId });
  if (section !== selectedSection || studentId !== $("reset-student").value) {
    status("ออกโค้ดแล้ว แต่มีการเปลี่ยนตัวเลือก กรุณาเลือกนักศึกษาคนเดิมและออกโค้ดใหม่");
    return;
  }
  $("reset-recipient").textContent = recipient;
  $("reset-code").textContent = result.code;
  show("teacher-reset-result");
  status("ส่งโค้ดรีเซ็ตและลิงก์ให้นักศึกษาที่เลือกโดยตรง");
});
function renderActivationCodes(section) {
  const result = issuedCodesBySection.get(section?.id);
  $("activation-results").hidden = !result?.code;
  $("activation-section-name").textContent = result?.code ? section.name : "";
  $("section-activation-code").textContent = result?.code ?? "";
  $("section-activation-expiry").textContent = result?.expires_at ? thaiDateTime.format(new Date(result.expires_at)) : "";
}
bind($("issue-activation-section"), "click", async () => {
  const section = selectedSection;
  if (!section || !window.confirm(`ออก Activation Code กลางสำหรับตอน ${section.name}? โค้ดเดิมที่ยังไม่ได้ใช้ในตอนนี้จะใช้ไม่ได้`)) return;
  $("section").disabled = true;
  try {
    const result = await rpc("sa702211_section_activation_code", { p_section: section.id });
    issuedCodesBySection.set(section.id, result);
    renderActivationCodes(section);
    status(result.code ? `ออก Activation Code กลางสำหรับตอน ${section.name} แล้ว` : `ตอน ${section.name} ไม่มีนักศึกษาที่ต้องออก Activation Code`);
  } finally {
    $("section").disabled = false;
  }
});
bind($("start"), "click", async () => {
  if (!selectedSection) return;
  const section = selectedSection;
  const { id } = await teacher("start", section.id);
  section.session_id = id;
});
bind($("end"), "click", async () => {
  if (!selectedSection?.session_id || !window.confirm("ปิดการเช็คชื่อสำหรับคาบนี้?")) return;
  const section = selectedSection;
  await teacher("end", section.session_id);
  section.session_id = null;
  status("ปิดเช็คชื่อแล้ว");
});
$("open-projector").addEventListener("click", () => {
  if (selectedSection?.session_id) window.open(route({ projector: selectedSection.session_id }), "_blank", "noopener");
});
bind($("add-student-form"), "submit", async (event) => {
  const form = event.currentTarget;
  const section = selectedSection;
  if (!section) return;
  const { student_code, full_name } = formData(form);
  if (!student_code.trim() || !full_name.trim()) throw new Error("INVALID_ROSTER_ROW");
  await rpc("sa702211_add_student", {
    p_section: section.id,
    p_student_code: student_code,
    p_full_name: full_name,
  });
  form.reset();
  status(`เพิ่มนักศึกษาในตอน ${section.name} แล้ว`);
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
    $("qr-state").textContent = "ปิดเช็คชื่อแล้ว";
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

let signupQrTimer;
let signupQrRequest = 0;
function updateActivationQr() {
  clearTimeout(signupQrTimer);
  const request = ++signupQrRequest;
  const panel = $("activation-qr-panel");
  const canvas = $("activation-qr");
  const notice = $("activation-qr-status");
  canvas.hidden = true;
  notice.textContent = "";
  if (!panel.open || !selectedSection || !selectedCourse) return;
  const section = selectedSection;
  const url = route({ activate: selectedCourse.id });
  void (async () => {
    let refreshIn;
    let activeQr = false;
    if (section.session_id) {
      try {
        const sent = performance.now();
        const result = await teacher("qr", section.session_id);
        const deadline = sent + Date.parse(result.expires_at) - Date.parse(result.server_now);
        refreshIn = Math.max(200, deadline - performance.now());
        if (deadline > performance.now()) {
          url.hash = new URLSearchParams({ checkin: result.token });
          activeQr = true;
        }
      } catch {
        refreshIn = 5000;
      }
    }
    if (request !== signupQrRequest) return;
    try {
      await QRCode.toCanvas(canvas, url.href, { width: 432, margin: 3, errorCorrectionLevel: "M" });
      if (request !== signupQrRequest) return;
      canvas.hidden = false;
      notice.textContent = activeQr
        ? "สแกนเพื่อลงทะเบียนและเช็คชื่อคาบนี้ QR เปลี่ยนทุก 30 วินาที"
        : "สแกนเพื่อลงทะเบียน เมื่อเปิดคาบให้สแกน QR เช็คชื่อจากจออาจารย์";
    } catch {
      if (request === signupQrRequest) notice.textContent = "แสดง QR ไม่ได้ กรุณาใช้ลิงก์เปิดใช้งาน";
    }
    if (request === signupQrRequest && refreshIn !== undefined) {
      signupQrTimer = setTimeout(updateActivationQr, refreshIn);
    }
  })();
}

let checkinCourseId;
let registrationTicket;

function returnToCheckin() {
  $("activate").hidden = true;
  show("checkin");
  $("checkin-form").elements.pin.focus();
}

bind($("back-to-checkin"), "click", returnToCheckin);
$("after-activation-link").addEventListener("click", (event) => {
  if (!checkinCourseId || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  returnToCheckin();
  status("ใช้ PIN ที่เพิ่งตั้งเพื่อเช็คชื่อ หากหมดเวลาให้สแกน QR ใหม่");
});
bind($("activate-form"), "submit", async (event) => {
  const form = event.currentTarget;
  const data = formData(form);
  await registrationTicket;
  await student("activate", { ...data, course_id: checkinCourseId ?? query.get("activate") });
  form.reset();
  if (checkinCourseId) {
    const checkin = $("checkin-form");
    checkin.elements.student_code.value = data.student_code.trim();
    checkin.elements.pin.value = "";
    checkin.elements.pin.required = true;
    $("first-registration").hidden = true;
    $("back-to-checkin").hidden = true;
  }
  form.hidden = true;
  show("after-activation");
  status("ลงทะเบียนสำเร็จ ใช้ PIN ที่เพิ่งตั้งเพื่อเช็คชื่อ");
});
bind($("reset-pin-form"), "submit", async (event) => {
  const form = event.currentTarget;
  const { student_code, reset_code, pin, confirm_pin } = formData(form);
  const courseId = query.get("reset");
  if (pin !== confirm_pin) {
    status("PIN ใหม่ทั้งสองช่องต้องตรงกัน");
    return;
  }
  await rpc("sa702211_reset_pin", { p_data: { student_code, reset_code, pin, course_id: courseId } });
  const device = getDevice();
  if (device?.course === courseId && device.code === student_code.trim()) {
    try { localStorage.removeItem(savedDeviceKey); } catch { /* Device access is already revoked on the server. */ }
  }
  form.reset();
  form.hidden = true;
  status("ตั้ง PIN ใหม่แล้ว สแกน QR แล้วใช้ PIN ใหม่เพื่อเช็คชื่อ");
});
function getDevice() {
  try { return JSON.parse(localStorage.getItem(savedDeviceKey)); }
  catch { return null; }
}
async function showCheckin(token) {
  show("checkin");
  prepareCheckin(await student("redeem", { token }));
}

function prepareCheckin(ticket) {
  $("forgot-pin-link").href = route({ reset: ticket.course_id });
  const firstRegistration = $("first-registration-link");
  firstRegistration.href = route({ activate: ticket.course_id });
  show("checkin-help");
  const form = $("checkin-form");
  firstRegistration.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    checkinCourseId = ticket.course_id;
    $("checkin").hidden = true;
    show("activate");
    show("back-to-checkin");
    const studentCode = $("activate-form").elements.student_code;
    studentCode.value = form.elements.student_code.value.trim();
    studentCode.focus();
    status();
  });
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
    $("checkin-help").hidden = true;
    status(result.already_checked_in ? "คุณเช็คชื่อคาบนี้แล้ว" : "เช็คชื่อสำเร็จ");
  });
}
async function showAttendanceReport() {
  show("attendance-report");
  updateTeacherNav("report");
  const courses = await teacher("courses");
  const sections = courses.find(({ code }) => code === "702211")?.sections ?? [];
  const picker = $("report-section");
  picker.replaceChildren(...sections.map(({ id, name }) => new Option(name, id)));
  const requested = query.get("section");
  if (sections.some(({ id }) => id === requested)) picker.value = requested;
  if (!sections.length) {
    picker.disabled = true;
    $("refresh-report").disabled = true;
    $("report-message").textContent = "ยังไม่มีตอนเรียนสำหรับบัญชีนี้";
    return;
  }
  let request = 0;
  async function load() {
    updateTeacherNav("report", picker.value);
    const current = ++request;
    $("report-table").hidden = true;
    $("report-head").replaceChildren();
    $("report-rows").replaceChildren();
    $("report-message").textContent = "กำลังโหลดรายงาน…";
    try {
      const { sessions, students } = await rpc("sa702211_section_report", { p_section: picker.value });
      if (request !== current) return;
      $("report-message").textContent = !sessions.length ? "ตอนนี้ยังไม่มีคาบเช็คชื่อ"
        : !students.length ? "ยังไม่มีนักศึกษาที่เช็คชื่อสำเร็จ" : "";
      if (!sessions.length) return;
      function addHeading(label, date) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = label;
        if (date) {
          const time = document.createElement("time");
          time.dateTime = date;
          time.textContent = thaiDateTime.format(new Date(date));
          th.append(document.createElement("br"), time);
        }
        $("report-head").append(th);
      }
      addHeading("รหัสนักศึกษา");
      addHeading("ชื่อ–นามสกุล");
      for (const session of sessions) addHeading(`ครั้งที่ ${session.number}`, session.started_at);
      $("report-rows").replaceChildren(...students.map(({ student_code, full_name, checked }) => {
        const row = document.createElement("tr");
        row.insertCell().textContent = student_code;
        row.insertCell().textContent = full_name;
        const attended = new Set(checked);
        for (const session of sessions) {
          const cell = row.insertCell();
          const present = attended.has(session.number);
          cell.textContent = present ? "✓" : "—";
          cell.setAttribute("aria-label", present ? "เช็คชื่อสำเร็จ" : "ไม่มีรายการเช็คชื่อ");
        }
        return row;
      }));
      show("report-table");
    } catch (error) {
      if (request !== current) return;
      $("report-message").textContent = "";
      report(error);
    }
  }
  picker.addEventListener("change", () => { status(); void load(); });
  bind($("refresh-report"), "click", load);
  await load();
}

async function main() {
  if (query.has("activate")) {
    show("activate");
    if (fragment.has("checkin")) {
      const token = fragment.get("checkin");
      history.replaceState(null, "", route({ activate: query.get("activate") }));
      registrationTicket = student("redeem", { token }).then((ticket) => {
        if (ticket.course_id !== query.get("activate")) return;
        prepareCheckin(ticket);
        checkinCourseId = ticket.course_id;
      }).catch(() => {
        // The registration link also works if the class QR has expired.
      });
    }
  } else if (fragment.has("checkin")) {
    const token = fragment.get("checkin");
    history.replaceState(null, "", page);
    await showCheckin(token);
  } else if (query.has("checkin")) {
    show("checkin");
    show("scan-attendance-instructions");
  } else if (query.has("reset")) {
    show("reset-pin");
  } else if (query.has("teacher") || query.has("projector")) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) show("login");
    else if (query.has("projector")) await showProjector(query.get("projector"));
    else if (query.has("report")) await showAttendanceReport();
    else await showTeacher();
  } else {
    show("home");
  }
}
main().catch(report);
