import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEBT_STORAGE_KEY } from "./debt-ledger.js";

const html = await readFile(new URL("./history.html", import.meta.url), "utf8");
let session = 0;

// A small DOM adapter runs the real page's event handlers and storage operations.
async function openLedger(t, entries) {
  const nodes = new Map();
  function createElement() {
    const listeners = new Map();
    return {
      value: "", textContent: "", hidden: false, checked: false, dataset: {},
      disabled: false, indeterminate: false,
      get innerHTML() { return this.markup ?? this.textContent; },
      set innerHTML(value) { this.markup = value; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      fire(type, target = this) { return listeners.get(type)?.({ target }); },
      setAttribute() {}, removeAttribute() {}, focus() {},
      querySelector() { return null; },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire("close"); },
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(`#${match[1]}`, createElement());
  const values = new Map([[DEBT_STORAGE_KEY, JSON.stringify(entries)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
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
  await import(`./history.js?selection-test=${++session}`);
  const get = (id) => {
    const element = nodes.get(`#${id}`);
    assert.ok(element, `Missing control: ${id}`);
    return element;
  };
  return {
    get,
    change(id, value) { const element = get(id); element.value = value; element.fire("change"); },
    selectAll(checked) { const element = get("debt-select-page"); element.checked = checked; element.fire("change"); },
    click(id) { get(id).fire("click"); },
    rows() { return [...get("debt-ledger-list").innerHTML.matchAll(/data-select-debt-id="([^"]+)"/g)].map((match) => match[1]); },
    stored() { return JSON.parse(storage.getItem(DEBT_STORAGE_KEY)); },
  };
}

function entry(id, overrides = {}) {
  return { id, billId: id, creditor: "Diem", debtor: "An", amount: 10000,
    date: "2026-09-01", savedAt: "2026-09-01T10:00:00Z", status: "unpaid", ...overrides };
}
const entries = [
  ...Array.from({ length: 23 }, (_, i) => entry(`unpaid-${i}`)),
  entry("paid", { status: "paid" }),
  entry("other-person", { debtor: "Binh" }),
  entry("other-year", { date: "2025-09-01" }),
];

test("status, person and year filters combine before pagination; all selects every matching page", async (t) => {
  const page = await openLedger(t, entries);
  page.change("debt-person-filter", "an");
  page.change("debt-year-filter", "2026");
  page.change("debt-status-filter", "unpaid");
  assert.equal(page.rows().length, 10);
  assert.match(page.get("debt-page-status").textContent, /trên 23 khoản/);
  page.selectAll(true);
  assert.equal(page.get("debt-selection-count").textContent, "23 khoản đã chọn");
  page.click("debt-page-next");
  page.click("debt-page-next");
  assert.equal(page.rows().length, 3);
  assert.equal(page.get("debt-select-page").checked, true);
  page.click("debt-bulk-mark-paid");
  assert.match(page.get("debt-status-title").textContent, /23 khoản/);
  page.click("confirm-debt-status-update");
  assert.equal(page.stored().filter(({ status }) => status === "paid").length, 24);
  assert.equal(page.stored().find(({ id }) => id === "other-person").status, "unpaid");
  assert.equal(page.stored().find(({ id }) => id === "other-year").status, "unpaid");
  assert.equal(page.get("debt-filter-empty").hidden, false);
  assert.equal(page.get("debt-select-page").disabled, true);
  assert.equal(page.get("debt-select-page").checked, false);
  assert.equal(page.get("debt-bulk-actions").hidden, true);
});

test("unfiltered select all and deselect all work across pages", async (t) => {
  const page = await openLedger(t, entries);
  page.selectAll(true);
  assert.equal(page.get("debt-selection-count").textContent, "26 khoản đã chọn");
  page.click("debt-page-next");
  page.selectAll(false);
  assert.equal(page.get("debt-selection-count").textContent, "0 khoản đã chọn");
  assert.equal(page.get("debt-select-page").indeterminate, false);
});

test("a partial selection on another page keeps the header indeterminate", async (t) => {
  const page = await openLedger(t, entries);
  const row = { checked: true, dataset: { selectDebtId: page.rows()[0] }, closest(selector) { return selector === "tr" ? null : this; } };
  page.get("debt-ledger-list").fire("change", row);
  page.click("debt-page-next");
  assert.equal(page.get("debt-select-page").checked, false);
  assert.equal(page.get("debt-select-page").indeterminate, true);
  page.selectAll(true);
  assert.equal(page.get("debt-selection-count").textContent, "26 khoản đã chọn");
});

test("changing any filter clears selection and returns to the first page", async (t) => {
  const page = await openLedger(t, entries);
  for (const [id, value] of [["debt-person-filter", "an"], ["debt-year-filter", "2026"], ["debt-status-filter", "unpaid"]]) {
    page.selectAll(true);
    page.click("debt-page-next");
    page.change(id, value);
    assert.equal(page.get("debt-bulk-actions").hidden, true);
    assert.match(page.get("debt-page-status").textContent, /^Trang 1 /);
  }
  page.change("debt-status-filter", "paid");
  assert.deepEqual(page.rows(), ["paid"]);
  page.change("debt-status-filter", "");
  assert.match(page.get("debt-page-status").textContent, /trên 24 khoản/);
});

test("changing a selected row's status removes it from the filtered selection", async (t) => {
  const page = await openLedger(t, entries);
  page.change("debt-status-filter", "unpaid");
  page.selectAll(true);
  const id = page.rows()[0];
  const button = { dataset: { toggleDebtStatus: id }, closest() { return this; } };
  page.get("debt-ledger-list").fire("click", button);
  assert.equal(page.get("debt-selection-count").textContent, "24 khoản đã chọn");
  assert.equal(page.rows().includes(id), false);
  assert.equal(page.get("debt-select-page").checked, true);
});

test("empty ledger has no selectable entries", async (t) => {
  const page = await openLedger(t, []);
  assert.equal(page.get("debt-select-page").disabled, true);
  assert.equal(page.get("debt-select-page").checked, false);
  assert.equal(page.get("debt-select-page").indeterminate, false);
});
