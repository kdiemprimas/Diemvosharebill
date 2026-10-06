import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEBT_STORAGE_KEY } from "./debt-ledger.js";

const html = await readFile(new URL("./history.html", import.meta.url), "utf8");
let session = 0;

// Run the real page handlers against the same small DOM adapter as selection tests.
async function openLedger(t, entries) {
  const nodes = new Map();
  const manualFields = ["creditor", "debtor", "amount", "date", "note", "status"];
  function createElement() {
    const listeners = new Map();
    const attributes = new Map();
    return {
      value: "", textContent: "", hidden: false, checked: false, dataset: {},
      disabled: false, indeterminate: false, open: false,
      get innerHTML() { return this.markup ?? this.textContent; },
      set innerHTML(value) { this.markup = value; },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      fire(type, target = this) {
        const event = { target, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; } };
        for (const listener of listeners.get(type) ?? []) listener(event);
        return event;
      },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      focus() { this.focused = true; },
      querySelector() { return null; },
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire("close"); },
      reset() {
        for (const field of manualFields) nodes.get(`#manual-debt-${field}`).value = "";
      },
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(`#${match[1]}`, createElement());
  const values = new Map([[DEBT_STORAGE_KEY, JSON.stringify(entries)]]);
  let writes = 0;
  let rejectWrites = false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (rejectWrites) throw new Error("Storage unavailable");
      writes += 1;
      values.set(key, value);
    },
  };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    document: { querySelector: (selector) => nodes.get(selector), querySelectorAll: () => [], createElement },
    window: { addEventListener() {}, setTimeout() {} },
    localStorage: storage,
  });
  t.after(() => {
    for (const key of ["document", "window", "localStorage"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  });
  await import(`./history.js?edit-test=${++session}`);
  const get = (id) => {
    const element = nodes.get(`#${id}`);
    assert.ok(element, `Missing control: ${id}`);
    return element;
  };
  return {
    get,
    fill(field, value) { get(`manual-debt-${field}`).value = value; },
    input(field, value) {
      const element = get(`manual-debt-${field}`);
      element.value = value;
      element.selectionStart = value.length;
      element.fire("input");
    },
    change(id, value) { const element = get(id); element.value = value; element.fire("change"); },
    click(id) { get(id).fire("click"); },
    edit(id) {
      assert.ok(this.rows().includes(id), `Missing visible debt row: ${id}`);
      assert.ok(get("debt-ledger-list").innerHTML.includes(`data-edit-debt-id="${id}"`), "Row should expose an edit action");
      const button = { dataset: { editDebtId: id },
        closest(selector) { return selector === "[data-edit-debt-id]" ? this : null; } };
      get("debt-ledger-list").fire("click", button);
    },
    submit() { get("manual-debt-form").fire("submit"); },
    escape() {
      const dialog = get("manual-debt-dialog");
      if (!dialog.fire("cancel").defaultPrevented) dialog.close();
    },
    rows() { return [...get("debt-ledger-list").innerHTML.matchAll(/data-select-debt-id="([^"]+)"/g)].map((match) => match[1]); },
    stored() { return JSON.parse(storage.getItem(DEBT_STORAGE_KEY)); },
    writes() { return writes; },
    rejectWrites() { rejectWrites = true; },
    replaceStored(nextEntries) { values.set(DEBT_STORAGE_KEY, JSON.stringify(nextEntries)); },
  };
}

function entry(id, overrides = {}) {
  return { id, billId: "shared-bill", creditor: "Diem", debtor: "An", amount: 10000,
    date: "2026-09-01", note: "Ăn trưa", savedAt: "2026-09-01T10:00:00.000Z",
    status: "unpaid", ...overrides };
}

test("each debt row opens an edit form filled with its saved information", async (t) => {
  const debt = entry("bill-person-1", { amount: 29000, status: "paid", note: "2land" });
  const page = await openLedger(t, [debt]);
  page.edit(debt.id);
  assert.equal(page.get("manual-debt-dialog").open, true);
  assert.equal(page.get("manual-debt-title").textContent, "Sửa khoản nợ");
  assert.equal(page.get("save-manual-debt").textContent, "Lưu thay đổi");
  for (const [field, value] of Object.entries({ creditor: "Diem", debtor: "An", amount: "29.000",
    date: "2026-09-01", note: "2land", status: "paid" })) {
    assert.equal(page.get(`manual-debt-${field}`).value, value);
  }
  assert.equal(page.writes(), 0);
});

test("saving edits updates only the selected entry, preserves identity and refreshes rows and summaries", async (t) => {
  const original = entry("bill-person-1");
  const sibling = entry("bill-person-2", { debtor: "Chi", status: "paid" });
  const page = await openLedger(t, [original, sibling]);
  page.edit(original.id);
  for (const [field, value] of Object.entries({ creditor: "Mai", debtor: "Binh", amount: "45.000",
    date: "2027-01-05", note: "Vé xem phim", status: "paid" })) page.fill(field, value);
  page.submit();

  assert.equal(page.get("manual-debt-dialog").open, false);
  const saved = page.stored();
  assert.equal(saved.length, 2);
  assert.deepEqual(saved.find(({ id }) => id === original.id), {
    ...original, creditor: "Mai", debtor: "Binh", amount: 45000,
    date: "2027-01-05", note: "Vé xem phim", status: "paid",
  });
  assert.deepEqual(saved.find(({ id }) => id === sibling.id), sibling);
  assert.deepEqual(page.rows(), [original.id, sibling.id]);
  assert.match(page.get("debt-ledger-list").innerHTML, /Binh/);
  assert.match(page.get("debt-ledger-list").innerHTML, /05\/01\/2027/);
  assert.match(page.get("debt-ledger-list").innerHTML, /Vé xem phim/);
  assert.equal(page.get("debt-total-unpaid").textContent, "0 ₫");
  assert.equal(page.get("debt-total-paid").textContent, "55.000 ₫");
  assert.match(page.get("debt-summary-list").innerHTML, /Binh/);
  assert.match(page.get("debt-person-filter").innerHTML, /value="binh"/);
  assert.match(page.get("debt-year-filter").innerHTML, /value="2027"/);
  assert.equal(page.get("debt-bulk-feedback").textContent, "Đã cập nhật khoản nợ thành công.");
  assert.equal(page.get("debt-bulk-feedback").hidden, false);
});

test("editing status refreshes active filters, selection and totals", async (t) => {
  const page = await openLedger(t, [entry("first"), entry("second")]);
  page.change("debt-person-filter", "an");
  page.change("debt-year-filter", "2026");
  page.change("debt-status-filter", "unpaid");
  const selectAll = page.get("debt-select-page");
  selectAll.checked = true;
  selectAll.fire("change");
  page.edit("first");
  page.fill("amount", "25.000");
  page.fill("status", "paid");
  page.submit();

  assert.deepEqual(page.rows(), ["second"]);
  assert.equal(page.get("debt-status-filter").value, "unpaid");
  assert.match(page.get("debt-person-filter").innerHTML, /value="an" selected/);
  assert.match(page.get("debt-year-filter").innerHTML, /value="2026" selected/);
  assert.equal(page.get("debt-total-unpaid").textContent, "10.000 ₫");
  assert.equal(page.get("debt-total-paid").textContent, "25.000 ₫");
  assert.equal(page.get("debt-unpaid-count").textContent, "1");
  assert.doesNotMatch(page.get("debt-selection-count").textContent, /^2 /);
});

for (const closeMethod of ["cancel", "Escape"]) {
  test(`${closeMethod} discards edits and the add action starts a fresh creation form`, async (t) => {
    const original = entry("first", { status: "paid" });
    const page = await openLedger(t, [original]);
    page.edit(original.id);
    page.fill("note", "Không lưu thay đổi này");
    if (closeMethod === "cancel") page.click("cancel-manual-debt");
    else page.escape();
    assert.equal(page.get("manual-debt-dialog").open, false);
    assert.equal(page.writes(), 0);
    assert.deepEqual(page.stored(), [original]);

    page.click("open-manual-debt");
    assert.equal(page.get("manual-debt-dialog").open, true);
    assert.equal(page.get("manual-debt-title").textContent, "Thêm một khoản nợ");
    assert.equal(page.get("save-manual-debt").textContent, "Lưu khoản nợ");
    for (const field of ["creditor", "debtor", "amount", "note"]) {
      assert.equal(page.get(`manual-debt-${field}`).value, "");
    }
    assert.equal(page.get("manual-debt-status").value, "unpaid");
    assert.match(page.get("manual-debt-date").value, /^\d{4}-\d{2}-\d{2}$/);
    for (const [field, value] of Object.entries({ creditor: "Mai", debtor: "Binh", amount: "20.000",
      date: "2026-10-06", note: "Khoản mới" })) page.fill(field, value);
    page.submit();
    assert.equal(page.stored().length, 2);
    assert.deepEqual(page.stored().find(({ id }) => id === original.id), original);
    const created = page.stored().find(({ id }) => id !== original.id);
    assert.equal(created.debtor, "Binh");
    assert.equal(created.amount, 20000);
  });
}

test("invalid edits keep the dialog open and never change saved data", async (t) => {
  const original = entry("first");
  const page = await openLedger(t, [original]);
  for (const [field, value] of [["creditor", ""], ["debtor", "  diem  "], ["amount", "0"],
    ["amount", "invalid"], ["date", ""]]) {
    page.edit(original.id);
    page.fill(field, value);
    page.submit();
    assert.equal(page.get("manual-debt-dialog").open, true);
    assert.ok(page.get("manual-debt-error").textContent);
    assert.equal(page.get(`manual-debt-${field}`).getAttribute("aria-invalid"), "true");
    assert.equal(page.writes(), 0);
    assert.deepEqual(page.stored(), [original]);
    page.click("cancel-manual-debt");
  }
});

test("a note edit preserves an existing negative amount including its formatted sign", async (t) => {
  const original = entry("refund", { amount: -10000 });
  const page = await openLedger(t, [original]);
  page.edit(original.id);
  assert.equal(page.get("manual-debt-amount").value, "-10.000");
  page.input("amount", "-10000");
  assert.equal(page.get("manual-debt-amount").value, "-10.000");
  page.fill("note", "Điều chỉnh hoàn tiền");
  page.submit();
  assert.equal(page.get("manual-debt-dialog").open, false);
  assert.deepEqual(page.stored(), [{ ...original, note: "Điều chỉnh hoàn tiền" }]);
  assert.equal(page.get("debt-total-unpaid").textContent, "-10.000 ₫");
});

test("saving an edit reads current storage and retains entries added or changed in another tab", async (t) => {
  const original = entry("first");
  const sibling = entry("second", { debtor: "Chi" });
  const added = entry("third", { debtor: "Binh", amount: 70000 });
  const page = await openLedger(t, [original, sibling]);
  page.edit(original.id);
  const updatedSibling = { ...sibling, status: "paid", note: "Đã trả ở tab khác" };
  page.replaceStored([original, updatedSibling, added]);
  page.fill("note", "Sửa ghi chú");
  page.submit();
  assert.equal(page.stored().length, 3);
  assert.deepEqual(page.stored().find(({ id }) => id === sibling.id), updatedSibling);
  assert.deepEqual(page.stored().find(({ id }) => id === added.id), added);
  assert.equal(page.stored().find(({ id }) => id === original.id).note, "Sửa ghi chú");
});

test("an entry deleted while its edit dialog is open cannot be recreated by saving", async (t) => {
  const original = entry("first");
  const survivor = entry("second", { debtor: "Chi" });
  const page = await openLedger(t, [original, survivor]);
  page.edit(original.id);
  page.replaceStored([survivor]);
  page.fill("note", "Không được tạo lại khoản đã xóa");
  page.submit();
  assert.equal(page.get("manual-debt-dialog").open, true);
  assert.ok(page.get("manual-debt-error").textContent);
  assert.equal(page.writes(), 0);
  assert.deepEqual(page.stored(), [survivor]);
});

test("storage failure leaves edits available to retry without changing the ledger", async (t) => {
  const original = entry("first");
  const page = await openLedger(t, [original]);
  page.edit(original.id);
  page.fill("note", "Giữ thông tin để thử lại");
  page.rejectWrites();
  page.submit();
  assert.equal(page.get("manual-debt-dialog").open, true);
  assert.equal(page.get("manual-debt-note").value, "Giữ thông tin để thử lại");
  assert.match(page.get("manual-debt-error").textContent, /lưu/);
  assert.equal(page.writes(), 0);
  assert.deepEqual(page.stored(), [original]);
  assert.notEqual(page.get("debt-bulk-feedback").textContent, "Đã cập nhật khoản nợ thành công.");
});
