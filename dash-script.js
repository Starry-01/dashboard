/* ========================= */
/* CELESTICATE DASH — PHASE 3C */
/* ========================= */

/*
    Phase 3B connects the existing Phase 3A visual skeleton to the
    SAME Supabase project the Portal already writes to, and replaces
    the placeholder/sample cards with real rows from public.orders.

    This phase is READ-ONLY: no insert/update/delete happens here.

    Paste the SAME values already used in the Portal's script.js below
    — this must be the identical Supabase project and the identical
    browser-safe publishable (anon) key. Do NOT use a service_role or
    secret key here or anywhere else in browser code.
*/

const SUPABASE_URL = "https://jlflyufuzrouqclbgrih.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_d09fZHNBYY1W-pdgHm1XxQ_vm5xQydg";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


/* ========================= */
/* STATE */
/* ========================= */

let allOrders = [];    // every row returned by Supabase, newest first
let ordersById = {};   // order_id -> row, so a card click can look itself up


/* ========================= */
/* VIEW SWITCHING (unchanged from Phase 3A) */
/* ========================= */

function switchView(viewName) {

    document.querySelectorAll(".dash-view").forEach(view => {
        view.classList.remove("active");
    });

    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.remove("active");
    });


    const targetView = document.getElementById(
        viewName === "orders" ? "viewOrders" : "viewDashboard"
    );

    const targetNavItem = document.getElementById(
        viewName === "orders" ? "navOrders" : "navDashboard"
    );


    if (targetView) targetView.classList.add("active");

    if (targetNavItem) targetNavItem.classList.add("active");

}


/* ========================= */
/* ORDER DETAIL OVERLAY (unchanged from Phase 3A) */
/* ========================= */

function openDetail() {

    document.getElementById("detailOverlay").classList.add("active");

    document.body.style.overflow = "hidden";

}


function closeDetail() {

    currentDetailKey = null;

    document.getElementById("detailOverlay").classList.remove("active");

    document.body.style.overflow = "";

}


document
    .getElementById("detailOverlay")
    .addEventListener("click", (event) => {

        /*
            Only close when the backdrop itself was
            clicked, not the panel content inside it.
        */

        if (event.target.id === "detailOverlay") {

            closeDetail();

        }

    });


document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {

        closeDetail();

    }

});


/* ========================= */
/* DASH STATE PANELS */
/* ========================= */

/*
    Exactly the three states Phase 3A already built markup for
    (loading / error / empty), plus the "data is ready" state that
    reveals the priority sections. Only one is ever visible at once.
*/

function showLoading() {

    hideLogin();

    document.getElementById("loadingState").classList.add("active");
    document.getElementById("errorState").classList.remove("active");
    document.getElementById("emptyOrdersState").classList.remove("active");

    document.getElementById("prioritySections").style.display = "none";

}

function showError(detail) {

    hideLogin();

    const detailEl = document.getElementById("errorDetail");

    if (detailEl && detail) detailEl.textContent = detail;

    document.getElementById("loadingState").classList.remove("active");
    document.getElementById("errorState").classList.add("active");
    document.getElementById("emptyOrdersState").classList.remove("active");

    document.getElementById("prioritySections").style.display = "none";

}

function showEmpty() {

    hideLogin();

    document.getElementById("loadingState").classList.remove("active");
    document.getElementById("errorState").classList.remove("active");
    document.getElementById("emptyOrdersState").classList.add("active");

    document.getElementById("prioritySections").style.display = "none";

}

function showData() {

    hideLogin();

    document.getElementById("loadingState").classList.remove("active");
    document.getElementById("errorState").classList.remove("active");
    document.getElementById("emptyOrdersState").classList.remove("active");

    document.getElementById("prioritySections").style.display = "";

}


/* ========================= */
/* AUTH (Supabase Auth, email + password) */
/* ========================= */

/*
    The Dash signs in as a real Supabase user, so its requests carry
    the "authenticated" role instead of the public Portal key's
    "anon" role. RLS (see fix4_dash_auth_rls.sql) then allows ONLY
    the admin user(s) to read orders and change their status.
    This login screen is a convenience; the database policies are
    the actual security boundary.
*/

function hideLogin() {

    const el = document.getElementById("loginState");

    if (el) el.classList.remove("active");

}

function showLogin(message) {

    document.getElementById("loadingState").classList.remove("active");
    document.getElementById("errorState").classList.remove("active");
    document.getElementById("emptyOrdersState").classList.remove("active");
    document.getElementById("prioritySections").style.display = "none";

    document.getElementById("loginState").classList.add("active");

    document.getElementById("btnSignOut").style.display = "none";

    setText("loginError", message || "");

    document.getElementById("loginPassword").value = "";

}

async function signIn() {

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
        setText("loginError", "Enter your email and password.");
        return;
    }

    const btn = document.getElementById("btnSignIn");

    btn.disabled = true;

    setText("loginError", "");

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    btn.disabled = false;

    if (error) {

        console.error("Dash sign-in failed:", error);

        setText("loginError", `Sign-in failed: ${error.message}`);

        return;

    }

    onSignedIn();

}

function onSignedIn() {

    document.getElementById("btnSignOut").style.display = "";

    loadOrders().then(ok => {

        if (ok) startRealtime();

    });

}

async function signOut() {

    /* The SIGNED_OUT listener below clears state and shows the login. */
    const { error } = await supabaseClient.auth.signOut();

    if (error) console.error("Sign-out error:", error);

}

function handleSignedOut() {

    stopRealtime();

    allOrders = [];
    ordersById = {};

    currentDetailKey = null;

    const overlay = document.getElementById("detailOverlay");

    if (overlay) overlay.classList.remove("active");

    renderOrdersView();

    updateOrderCount(0);

    showLogin();

}

supabaseClient.auth.onAuthStateChange((event) => {

    if (event === "SIGNED_OUT") handleSignedOut();

});

document.addEventListener("keydown", (event) => {

    if (event.key === "Enter" && event.target.closest && event.target.closest("#loginState")) {
        signIn();
    }

});


/* ========================= */
/* SAFE READ HELPERS */
/* ========================= */

/*
    The Portal stores several groups (client, project, content,
    custom, additional, payment) as JSONB. A row can have any of
    these as null, an empty object, or missing a particular key —
    none of that should ever throw or print "[object Object]".
*/

function safe(value, fallback = "—") {

    if (value === null || value === undefined || value === "") return fallback;

    return value;

}

function readField(obj, key, fallback = "") {

    if (!obj || typeof obj !== "object") return fallback;

    const value = obj[key];

    if (value === null || value === undefined || value === "") return fallback;

    return value;

}

function escapeHTML(str) {

    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

}


/* ========================= */
/* DATE FORMAT */
/* ========================= */

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/*
    Matches the format already used in the Phase 3A markup:
    "27 Sep 2026 · 18:12" (short) / "27 September 2026 · 18:12" (long).
    No deadline/countdown logic — this only formats created_at as-is.
*/

function formatDate(isoString, style = "short") {

    if (!isoString) return "—";

    const date = new Date(isoString);

    if (isNaN(date.getTime())) return "—";

    const day = date.getDate();
    const month = style === "long" ? MONTHS_LONG[date.getMonth()] : MONTHS_SHORT[date.getMonth()];
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${day} ${month} ${year} · ${hours}:${minutes}`;

}


/* ========================= */
/* FETCH ORDERS FROM SUPABASE */
/* ========================= */

/*
    Exact query used (read-only):
        supabaseClient.from("orders").select("*").order("created_at", { ascending: false })
*/

async function fetchOrders() {

    return supabaseClient
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

}

function describeSupabaseError(error) {

    const raw = `${error.code || ""} ${error.status || ""} ${error.message || ""}`.toLowerCase();

    if (raw.includes("42501") || raw.includes("permission denied") || raw.includes("401") || raw.includes("403") || raw.includes("row-level security") || raw.includes("jwt")) {
        return "Permission denied reading public.orders (check the SELECT policy / RLS).";
    }

    if (raw.includes("42p01") || raw.includes("does not exist") || raw.includes("pgrst205")) {
        return "The orders table was not found in the public schema.";
    }

    if (raw.includes("fetch") || raw.includes("network")) {
        return "Network error while contacting Supabase.";
    }

    return "Supabase returned an error. Check the browser console for details.";

}

function setOrders(rows) {

    allOrders = rows || [];

    ordersById = {};

    allOrders.forEach(order => {
        ordersById[orderKey(order)] = order;
    });

}

function renderAll() {

    const active = allOrders.filter(isActive);

    updateOrderCount(active.length);

    if (allOrders.length === 0) {

        showEmpty();

        renderOrdersView();

        return;

    }

    showData();

    renderPriorityView(active);
    renderOrdersView();

    refreshOpenDetail();

}

/*
    Insert-or-replace by order key. Merging keeps columns a realtime
    UPDATE payload may omit, and guarantees a status change can never
    create a second copy of the same order.
*/

function upsertOrder(row) {

    const key = orderKey(row);

    const idx = allOrders.findIndex(o => orderKey(o) === key);

    const existed = idx >= 0;

    const merged = existed ? { ...allOrders[idx], ...row } : row;

    if (existed) allOrders[idx] = merged;
    else allOrders.push(merged);

    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    ordersById[key] = merged;

    return { existed, order: merged };

}

/*
    silent = true is used by reconnect/refresh re-fetches: it keeps
    the current cards on screen instead of flashing the loading state,
    and if that re-fetch fails the existing data stays visible.
*/

async function loadOrders(silent = false) {

    if (!silent) showLoading();

    let result;

    try {

        result = await fetchOrders();

    } catch (thrown) {

        result = { data: null, error: thrown };

    }

    const { data, error } = result;

    if (error) {

        console.error("Failed to load orders from Supabase:", error);

        if (!silent) showError(describeSupabaseError(error));

        return false;

    }

    setOrders(data);

    renderAll();

    return true;

}


/* ========================= */
/* HEADER COUNT (real) */
/* ========================= */

function updateOrderCount(count) {

    document.getElementById("orderCountSummary").textContent = count;

}


/* ========================= */
/* ORDER STATUS + QUEUE CLASSIFICATION (Phase 3C) */
/* ========================= */

/*
    Everything below is computed from the STORED values only:
        order.status              persistent lifecycle status
        order.priority            "priority" | "normal" | "not_sure"
        order.payment.percentage  what the customer SELECTED (50 | 100)
        order.payment.status      whether payment was VERIFIED
                                  (the Portal always writes "pending";
                                  real verification is Phase 3D)

    Nothing here changes the Portal's pricing or priority rules.
*/

const ACTIVE_STATUSES = ["new", "in_progress", "needs_review"];
const HISTORY_STATUSES = ["completed", "cancelled"];
const ALL_STATUSES = [...ACTIVE_STATUSES, ...HISTORY_STATUSES];

const STATUS_LABELS = {
    new: "New",
    in_progress: "In progress",
    needs_review: "Needs review",
    completed: "Completed",
    cancelled: "Cancelled"
};

/* Column not added yet, or null -> treat as "new". Anything else unrecognised -> "unknown". */
function normalizeStatus(order) {

    const raw = order.status;

    if (raw === null || raw === undefined || raw === "") return "new";

    const value = String(raw).trim().toLowerCase();

    return ALL_STATUSES.includes(value) ? value : "unknown";

}

function isActive(order) {

    const status = normalizeStatus(order);

    return ACTIVE_STATUSES.includes(status) || status === "unknown";

}

function normalizePriority(raw) {

    if (raw === null || raw === undefined) return null;

    const value = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");

    if (value === "priority") return "priority";
    if (value === "normal") return "normal";
    if (value === "not_sure" || value === "undecided" || value === "notsure") return "unsure";

    return "unknown";

}

/* Only 50 and 100 are valid selections. Numeric strings are accepted; anything else is not. */
function parsePercentage(raw) {

    if (raw === null || raw === undefined || raw === "") return null;

    const n = typeof raw === "number" ? raw : Number(String(raw).trim());

    return n === 50 || n === 100 ? n : NaN;

}

/* Selection is not verification. Only an explicit verified-type value counts. */
function paymentVerification(order) {

    const raw = readField(order.payment, "status", "");

    const value = String(raw).trim().toLowerCase();

    if (["verified", "paid", "confirmed"].includes(value)) {
        return { key: "verified", label: "Verified" };
    }

    if (value === "pending" || value === "unverified") {
        return { key: "pending", label: "Pending (not verified)" };
    }

    return { key: "unknown", label: value ? `Unknown (${value})` : "Not recorded" };

}

function moneyOf(value) {

    if (value === null || value === undefined || value === "") return null;

    const n = Number(value);

    return Number.isFinite(n) ? n : null;

}

function formatMoney(value) {

    const n = moneyOf(value);

    return n === null ? "—" : `Rp ${n.toLocaleString("id-ID")}`;

}

/*
    Returns everything the UI needs to place an order:
        queue  1..4 (or null when it needs review)
        rank   sort key (5 = needs review)
    Queue: 1 Priority+100 · 2 Priority+50 · 3 Normal+100 · 4 Normal+50
*/

function classifyOrder(order) {

    const reasons = [];

    const status = normalizeStatus(order);

    const priorityKey = normalizePriority(order.priority);

    const pct = parsePercentage(readField(order.payment, "percentage", null));

    if (status === "unknown") reasons.push(`Unknown order status "${order.status}"`);
    if (status === "needs_review") reasons.push("Marked as needs review");

    if (priorityKey === null) reasons.push("Priority is missing");
    else if (priorityKey === "unknown") reasons.push(`Unexpected priority value "${order.priority}"`);
    else if (priorityKey === "unsure") reasons.push("Customer was not sure about priority");

    if (pct === null) reasons.push("Payment percentage is missing");
    else if (Number.isNaN(pct)) reasons.push("Unexpected payment percentage");

    /* Contradiction: stored total disagrees with stored base + custom. */
    const base = moneyOf(readField(order.pricing, "basePrice", null));
    const extra = moneyOf(readField(order.pricing, "customPrice", null));
    const total = moneyOf(readField(order.pricing, "total", null));

    if (base !== null && extra !== null && total !== null && base + extra !== total) {
        reasons.push("Stored total does not equal base + custom price");
    }

    const needsReview = reasons.length > 0;

    let queue = null;

    if (!needsReview) {
        if (priorityKey === "priority") queue = pct === 100 ? 1 : 2;
        else queue = pct === 100 ? 3 : 4;
    }

    return {
        status,
        priorityKey,
        pct: Number.isNaN(pct) ? null : pct,
        needsReview,
        reasons,
        queue,
        rank: queue || 5
    };

}

/* Queue rank first, then oldest first. */
function compareQueue(a, b) {

    const diff = classifyOrder(a).rank - classifyOrder(b).rank;

    if (diff !== 0) return diff;

    return new Date(a.created_at) - new Date(b.created_at);

}

function compareOldestFirst(a, b) {

    return new Date(a.created_at) - new Date(b.created_at);

}

/* ========================= */
/* PAYMENT CHIP (selection vs verification) */
/* ========================= */

/*
    "100% SELECTED" means the customer chose to pay 100%. It only
    reads "PAID" once payment.status is explicitly verified.
*/

function paymentStatusInfo(order) {

    const cls = classifyOrder(order);

    const verified = paymentVerification(order).key === "verified";

    if (cls.pct === 100) {
        return { key: "full", label: verified ? "100% PAID" : "100% SELECTED", fillClass: "full", cardClass: "is-full" };
    }

    if (cls.pct === 50) {
        return { key: "half", label: verified ? "50% PAID" : "50% SELECTED", fillClass: "half", cardClass: "is-half" };
    }

    return { key: "pending", label: "PAYMENT UNKNOWN", fillClass: "empty", cardClass: "is-pending" };

}


/* ========================= */
/* CARD BUILDING */
/* ========================= */

function orderKey(order) {

    return String(order.order_id || order.id);

}

function queueChipLabel(order) {

    const cls = classifyOrder(order);

    if (cls.status === "completed" || cls.status === "cancelled") {
        return STATUS_LABELS[cls.status].toUpperCase();
    }

    if (cls.needsReview) return "REVIEW";

    return `Q${cls.queue} · ${cls.priorityKey === "priority" ? "PRIORITY" : "NORMAL"}`;

}

function buildCardHTML(order) {

    const status = paymentStatusInfo(order);

    const cls = classifyOrder(order);

    const clientName = safe(readField(order.client, "fullName"), "Unnamed client");
    const projectName = safe(readField(order.project, "businessName"), "Untitled project");
    const orderId = orderKey(order);
    const dateLabel = formatDate(order.created_at, "short");

    const reviewTitle = cls.needsReview ? ` title="${escapeHTML(cls.reasons.join("; "))}"` : "";

    return `
        <button class="order-card ${status.cardClass}" data-order-id="${escapeHTML(orderId)}"${reviewTitle}>

            <p class="order-card-id mono">#${escapeHTML(orderId)} <span class="queue-chip mono">${escapeHTML(queueChipLabel(order))}</span></p>
            <p class="order-card-name">${escapeHTML(clientName)}</p>
            <p class="order-card-project">${escapeHTML(projectName)}</p>

            <div class="order-card-footer">

                <span class="status-chip">
                    <span class="status-fill ${status.fillClass}"></span>
                    ${status.label}
                </span>

                <span class="order-card-date mono">
                    ${dateLabel}
                </span>

            </div>

        </button>
    `;

}


/* ========================= */
/* PRIORITY VIEW RENDER */
/* ========================= */

/*
    Same sections as before. Each order lands in a section from its
    stored payment SELECTION; anything unclear goes to the existing
    third section, now labelled "Needs review". Inside every section
    orders are ordered by queue rank, then oldest first.
*/

function renderPriorityView(orders) {

    const full = [];

    const half = { Personal: [], Business: [], Organization: [], Other: [] };

    const review = [];


    orders.forEach(order => {

        const cls = classifyOrder(order);

        if (cls.needsReview) {
            review.push(order);
            return;
        }

        if (cls.pct === 100) {
            full.push(order);
            return;
        }

        const websiteType = readField(order.project, "websiteType", "Other");

        const bucket = half[websiteType] ? websiteType : "Other";

        half[bucket].push(order);

    });

    Object.values(half).forEach(list => list.sort(compareQueue));
    full.sort(compareQueue);
    review.sort(compareOldestFirst);


    renderGrid("fullPaidGrid", "fullPaidEmpty", full);
    document.getElementById("fullPaidCount").textContent = full.length;

    renderGrid("halfPersonalGrid", "halfPersonalEmpty", half.Personal);
    renderGrid("halfBusinessGrid", "halfBusinessEmpty", half.Business);
    renderGrid("halfOrgGrid", "halfOrgEmpty", half.Organization);

    const halfTotal =
        half.Personal.length +
        half.Business.length +
        half.Organization.length +
        half.Other.length;

    document.getElementById("halfPaidCount").textContent = halfTotal;

    renderOtherBucket(half.Other);

    renderGrid("pendingGrid", "pendingEmpty", review);
    document.getElementById("pendingCount").textContent = review.length;

}


function renderGrid(gridId, emptyId, orders) {

    const grid = document.getElementById(gridId);

    if (!grid) return;

    const emptyEl = document.getElementById(emptyId);

    if (orders.length === 0) {

        grid.innerHTML = "";

        if (emptyEl) emptyEl.style.display = "";

        return;

    }

    if (emptyEl) emptyEl.style.display = "none";

    grid.innerHTML = orders.map(buildCardHTML).join("");

}


/*
    "Other" website types weren't part of the original three 50%-paid
    subsections (Personal / Business / Organization), but the
    Portal's website-type question also allows "Other". Rather than
    silently mis-file those orders under one of the three named
    categories (or drop them), this adds a fourth subsection using
    the exact same markup/classes as the existing ones — only when at
    least one such order exists.
*/

function renderOtherBucket(otherOrders) {

    let group = document.getElementById("halfOtherGroup");

    if (otherOrders.length === 0) {

        if (group) group.style.display = "none";

        return;

    }

    if (!group) {

        const paidGroup = document.querySelector("#sectionHalfPaid .paid-group");

        group = document.createElement("div");
        group.className = "order-subsection";
        group.id = "halfOtherGroup";

        group.innerHTML = `
            <p class="order-subsection-label">Other</p>
            <div class="order-grid" id="halfOtherGrid"></div>
            <p class="empty-inline" id="halfOtherEmpty" style="display:none;">No other orders yet.</p>
        `;

        paidGroup.appendChild(group);

    }

    group.style.display = "";

    renderGrid("halfOtherGrid", "halfOtherEmpty", otherOrders);

}


/* ========================= */
/* ORDERS VIEW: QUEUE / RECENT / HISTORY */
/* ========================= */

let ordersTab = "queue";

const ORDERS_TAB_TEXT = {
    queue:   ["Active queue", "Active orders in queue order. Needs review last."],
    recent:  ["Recent submissions", "All orders, newest first."],
    history: ["History", "Completed and cancelled orders. Nothing is deleted."]
};

function setOrdersTab(tab) {

    ordersTab = tab;

    renderOrdersView();

}

function renderOrdersView() {

    const grid = document.getElementById("recentGrid");

    if (!grid) return;

    document.querySelectorAll("#ordersTabs button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === ordersTab);
    });

    const [title, subtitle] = ORDERS_TAB_TEXT[ordersTab];

    setText("ordersHeading", title);
    setText("ordersSubheading", subtitle);

    let list;

    if (ordersTab === "queue") {
        list = allOrders.filter(isActive).sort(compareQueue);
    } else if (ordersTab === "history") {
        list = allOrders
            .filter(o => !isActive(o))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
        list = allOrders.slice();
    }

    if (list.length === 0) {

        const text = ordersTab === "history" ? "No completed or cancelled orders." : "No orders yet.";

        grid.innerHTML = `<p class="empty-inline">${text}</p>`;

        return;

    }

    grid.innerHTML = list.map(buildCardHTML).join("");

}

/* Kept so existing callers keep working. */
function renderRecent() { renderOrdersView(); }


/* ========================= */
/* CARD CLICK -> DETAIL VIEW */
/* ========================= */

function attachCardListeners() {

    /* Intentionally empty: clicks are handled once by delegation below. */

}

document.addEventListener("click", (event) => {

    const card = event.target.closest(".order-card[data-order-id]");

    if (!card) return;

    const order = ordersById[card.dataset.orderId];

    if (!order) {

        console.warn("Clicked card has no matching order:", card.dataset.orderId);

        return;

    }

    populateDetail(order);
    openDetail();

});


/* ========================= */
/* DETAIL VIEW POPULATION */
/* ========================= */

function setText(id, value) {

    const el = document.getElementById(id);

    if (el) el.textContent = value;

}

function formatPriority(priority) {

    if (priority === "priority") return "Priority";
    if (priority === "normal") return "Normal";
    if (priority === "not_sure") return "Not sure";

    return "—";

}

/*
    Existing Portal business logic, unchanged, only displayed here:
    priority -> recommend 100%, normal/not_sure -> recommend 50%.
*/

function recommendedPaymentLabel(priority) {

    if (priority !== "priority" && priority !== "normal" && priority !== "not_sure") {
        return "—";
    }

    return priority === "priority" ? "100%" : "50%";

}

function buildSocialLabel(client) {

    const handle = readField(client, "socialMedia");

    if (!handle) return "—";

    const platform = readField(client, "socialPlatform");

    return platform ? `${platform} — ${handle}` : handle;

}

/*
    custom.background / custom.animation / custom.others are each
    either null (not requested) or an object like
    { enabled, request, reference, imageName, link } from the
    Portal's collectCustomRequest(). Read defensively either way.
*/

function formatCustomRequest(entry) {

    if (!entry || entry.enabled !== true) return "Not requested";

    const parts = [];

    if (Number.isFinite(Number(entry.price)) && entry.price !== null) parts.push(`+${formatMoney(entry.price)}`);

    if (entry.request) parts.push(entry.request);
    if (entry.reference) parts.push(`Reference: ${entry.reference}`);

    return parts.length > 0 ? parts.join(" · ") : "Requested";

}

function renderDetailLinks(content) {

    const container = document.getElementById("detailLinks");

    if (!container) return;

    container.innerHTML = "";

    const url = readField(content, "reference");

    if (!url) return;

    const link = document.createElement("a");

    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Reference link";

    container.appendChild(link);

}

/*
    Uploaded-file URLs aren't part of the order schema yet (the
    Portal currently only stores filenames/descriptions, not public
    URLs) — this checks the common shapes a future upload fix might
    use, and simply shows nothing if none of them are present, rather
    than assuming one exact structure.
*/

function renderDetailThumbs(content) {

    const container = document.getElementById("detailThumbs");

    if (!container) return;

    container.innerHTML = "";

    const candidateUrls = [
        content?.logoUrl,
        content?.imageUrl,
        ...(Array.isArray(content?.imageUrls) ? content.imageUrls : [])
    ].filter(Boolean);

    candidateUrls.forEach(url => {

        const thumb = document.createElement("div");
        thumb.className = "detail-thumb";

        const img = document.createElement("img");
        img.src = url;
        img.alt = "Uploaded image";

        thumb.appendChild(img);

        thumb.addEventListener("click", () => window.open(url, "_blank"));

        container.appendChild(thumb);

    });

}

function setDetailActions(order) {

    const cls = classifyOrder(order);

    const active = isActive(order);

    const box = document.getElementById("detailActions");

    box.style.display = active ? "" : "none";

    dismissCancel();

    setActionError("");

    setActionBusy(false);

}

function refreshOpenDetail() {

    const overlay = document.getElementById("detailOverlay");

    if (!overlay || !overlay.classList.contains("active") || !currentDetailKey) return;

    const order = ordersById[currentDetailKey];

    if (order) populateDetail(order, true);

}

function populateDetail(order, isRefresh = false) {

    currentDetailKey = orderKey(order);

    const cls = classifyOrder(order);

    const pricing = order.pricing || {};

    const client = order.client || {};
    const project = order.project || {};
    const content = order.content || {};
    const custom = order.custom || {};
    const additional = order.additional || {};
    const payment = order.payment || {};


    setText("detailClientName", safe(client.fullName, "Unnamed client"));
    setText("detailOrderId", `#${safe(order.order_id, "—")}`);

    setText("detailSubmitted", formatDate(order.created_at, "long"));
    setText("detailPriority", formatPriority(order.priority));
    setText("detailPaymentStatus", paymentStatusInfo(order).label);
    setText("detailOrderStatus", STATUS_LABELS[cls.status] || "Unknown");
    setText("detailReviewReason", cls.needsReview ? cls.reasons.join("; ") : "None");

    setText("detailBase", formatMoney(pricing.basePrice));
    setText("detailCustomCost", formatMoney(pricing.customPrice));
    setText("detailTotal", formatMoney(pricing.total));

    setText("detailFullName", safe(client.fullName));
    setText("detailSocial", buildSocialLabel(client));
    setText("detailEmail", safe(client.email, "Not provided"));

    setText("detailProjectName", safe(project.businessName));
    setText("detailWebsiteType", safe(project.websiteType));
    setText("detailGoal", safe(project.goal));

    setText("detailContentStatus", safe(content.status));
    setText("detailStyle", safe(content.customVibe || content.visualVibe));
    setText("detailColors", safe(content.colors));
    setText("detailLogo", safe(content.logoStatus));
    setText("detailImages", safe(content.imageStatus, "Not provided"));

    renderDetailLinks(content);
    renderDetailThumbs(content);

    setText("detailBackground", formatCustomRequest(custom.background));
    setText("detailAnimation", formatCustomRequest(custom.animation));
    setText("detailOther", formatCustomRequest(custom.others));

    setText("detailPriorities", safe(additional.priorities));
    setText("detailAvoid", safe(additional.avoid));

    setText("detailRecommended", recommendedPaymentLabel(order.priority));
    setText("detailSelected", payment.percentage ? `${payment.percentage}% (selected, not verified)` : "—");
    setText("detailMethod", safe(payment.method));
    setText("detailStatus", paymentVerification(order).label);

    if (!isRefresh) setDetailActions(order);

}


/* ========================= */
/* TOASTS */
/* ========================= */

/*
    One small toast system (top-right, auto-dismiss, click to
    dismiss). "error" kind stays a little longer and uses a muted
    red accent; nothing here blocks the page.
*/

function showToast(label, idText, text, kind = "info") {

    let stack = document.getElementById("toastStack");

    if (!stack) {

        stack = document.createElement("div");
        stack.id = "toastStack";
        stack.setAttribute("aria-live", "polite");
        document.body.appendChild(stack);

    }

    const toast = document.createElement("div");

    toast.className = `dash-toast${kind === "error" ? " is-error" : ""}`;

    toast.innerHTML = `
        <p class="dash-toast-label mono">${escapeHTML(label)}</p>
        ${idText ? `<p class="dash-toast-id mono">${escapeHTML(idText)}</p>` : ""}
        <p class="dash-toast-text">${escapeHTML(text)}</p>
    `;

    const remove = () => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    };

    toast.addEventListener("click", remove);

    stack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(remove, kind === "error" ? 9000 : 6000);

}

function showNewOrderToast(order) {

    showToast("NEW ORDER", `#${orderKey(order)}`, "New project request received.");

}


/* ========================= */
/* FINISH / CANCEL (status updates) */
/* ========================= */

/*
    Never DELETEs. Only sets orders.status. Uses .select() on the
    UPDATE because Postgres RLS silently updates ZERO rows (no error)
    when no UPDATE policy applies — that case is reported as a failure,
    never as success.
*/

let currentDetailKey = null;
let statusUpdateBusy = false;

function describeUpdateError(error) {

    const code = error.code || "";
    const message = error.message || String(error);
    const raw = `${code} ${error.status || ""} ${message}`.toLowerCase();

    let friendly = "The status update failed.";

    if (raw.includes("42703") || (raw.includes("status") && raw.includes("does not exist")) || raw.includes("pgrst204")) {
        friendly = "The orders table has no status column yet (run phase3c_orders_status.sql).";
    } else if (raw.includes("23514") || raw.includes("check constraint")) {
        friendly = "The database rejected that status value (check constraint).";
    } else if (raw.includes("42501") || raw.includes("permission denied") || raw.includes("row-level security") || raw.includes("401") || raw.includes("403")) {
        friendly = "Update not permitted for the Dash's database role (RLS / grants).";
    } else if (raw.includes("fetch") || raw.includes("network")) {
        friendly = "Network error while contacting Supabase.";
    }

    return `${friendly} [${code || "no code"}: ${message}]`;

}

async function updateOrderStatus(order, newStatus) {

    let query = supabaseClient.from("orders").update({ status: newStatus });

    query = order.id !== null && order.id !== undefined
        ? query.eq("id", order.id)
        : query.eq("order_id", order.order_id);

    let result;

    try {

        result = await query.select();

    } catch (thrown) {

        result = { data: null, error: thrown };

    }

    const { data, error } = result;

    if (error) {

        console.error(`Failed to set status "${newStatus}" on order ${orderKey(order)}:`, error);

        return { ok: false, message: describeUpdateError(error) };

    }

    if (!data || data.length === 0) {

        console.error(
            `Status update on order ${orderKey(order)} changed 0 rows. ` +
            "Most likely no RLS UPDATE policy applies to this role, or the row no longer exists."
        );

        return {
            ok: false,
            message: "Nothing was updated. Either the admin RLS policies from fix4_dash_auth_rls.sql are not applied for the signed-in user, or the order no longer exists."
        };

    }

    upsertOrder(data[0]);

    return { ok: true };

}

function setActionBusy(busy) {

    statusUpdateBusy = busy;

    ["btnFinish", "btnCancel", "btnConfirmCancel", "btnKeep"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = busy;
    });

}

function setActionError(message) {

    setText("actionError", message || "");

}

async function runStatusChange(newStatus, successLabel) {

    if (statusUpdateBusy || !currentDetailKey) return;

    const order = ordersById[currentDetailKey];

    if (!order) return;

    setActionError("");
    setActionBusy(true);

    const result = await updateOrderStatus(order, newStatus);

    setActionBusy(false);

    if (!result.ok) {

        /* Order stays visible and unchanged. */
        setActionError(result.message);

        showToast("UPDATE FAILED", `#${orderKey(order)}`, result.message, "error");

        return;

    }

    renderAll();

    closeDetail();

    showToast(successLabel, `#${orderKey(order)}`, "Order kept in history. Nothing was deleted.");

}

function finishOrder() {

    runStatusChange("completed", "ORDER COMPLETED");

}

function askCancel() {

    document.getElementById("actionMain").style.display = "none";
    document.getElementById("actionConfirm").style.display = "";

}

function dismissCancel() {

    document.getElementById("actionMain").style.display = "";
    document.getElementById("actionConfirm").style.display = "none";

}

function confirmCancel() {

    runStatusChange("cancelled", "ORDER CANCELLED");

}


/* ========================= */
/* REALTIME (INSERT on public.orders) */
/* ========================= */

let realtimeChannel = null;
let hasSubscribedBefore = false;

function handleRealtimeInsert(payload) {

    const row = payload && payload.new;

    if (!row) return;

    /* Duplicate protection: already loaded by fetch or an earlier event. */
    if (ordersById[orderKey(row)]) return;

    upsertOrder(row);

    renderAll();

    showNewOrderToast(row);

}

/*
    UPDATE never appends: it replaces the matching local order and
    re-runs classification, so the card moves section/tab as needed.
    If the order was somehow never loaded, it is added quietly.
*/

function handleRealtimeUpdate(payload) {

    const row = payload && payload.new;

    if (!row) return;

    upsertOrder(row);

    renderAll();

}

function startRealtime() {

    /* Never create a second subscription. */
    if (realtimeChannel) return;

    realtimeChannel = supabaseClient
        .channel("dash-orders-inserts")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "orders" },
            handleRealtimeInsert
        )
        .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "orders" },
            handleRealtimeUpdate
        )
        .subscribe((status, err) => {

            if (status === "SUBSCRIBED") {

                console.log("Realtime subscribed to public.orders");

                /*
                    On (re)connect, re-fetch silently so any order
                    inserted while disconnected is not missed. Merge
                    is by order_id, so nothing is duplicated.
                */
                if (hasSubscribedBefore) loadOrders(true);

                hasSubscribedBefore = true;

                return;

            }

            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {

                console.error("Realtime status:", status, err || "");

                /* supabase-js retries the channel itself; we just log. */

            }

        });

}

function stopRealtime() {

    if (!realtimeChannel) return;

    supabaseClient.removeChannel(realtimeChannel);

    realtimeChannel = null;

}

window.addEventListener("pagehide", stopRealtime);


/* ========================= */
/* INIT */
/* ========================= */

supabaseClient.auth.getSession().then(({ data, error }) => {

    if (error) console.error("Could not read auth session:", error);

    if (data && data.session) onSignedIn();
    else showLogin();

});

/*
    Re-runs the same fetch/render. Safe to call repeatedly: it never
    creates another realtime subscription.
*/

window.refreshOrders = () => loadOrders(true);