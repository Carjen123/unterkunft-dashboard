import { supabase } from "./supabase.js";
import { supabase } from "./supabase.js";

const UNIT_COLORS = {
  "La Maison": "#60A5FA",
  "Maison Bleue": "#4ADE80",
  "Mozartsteg Streetliving": "#F472B6",
  "Mirabellplatz Streetliving": "#FBBF24",
};
const FALLBACK_COLORS = ["#A78BFA","#34D399","#FB923C","#E879F9","#22D3EE"];
const STATUS_CONFIG = {
  confirmed: { label: "Bestätigt", color: "#4ADE80", bg: "rgba(74,222,128,0.12)", dot: "#4ADE80" },
  pending:   { label: "Anfrage",   color: "#FBBF24", bg: "rgba(251,191,36,0.12)",  dot: "#FBBF24" },
  checkedin: { label: "Eingecheckt", color: "#60A5FA", bg: "rgba(96,165,250,0.12)", dot: "#60A5FA" },
  checkedout:{ label: "Ausgecheckt", color: "#9CA3AF", bg: "rgba(156,163,175,0.12)",dot: "#9CA3AF" },
};
const SOURCES = ["Direkt","Airbnb","Booking.com","VRBO","Expedia","Sonstige"];

function getNights(a, b) { if (!a||!b) return 0; return Math.max(0,Math.round((new Date(b)-new Date(a))/86400000)); }
function formatDate(d) { if (!d) return "–"; const [y,m,day]=d.split("-"); return `${day}.${m}.${y.slice(2)}`; }
function formatFullDate(d) { if (!d) return "–"; return new Date(d).toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"short"}); }
function todayISO() { return new Date().toISOString().slice(0,10); }
function getUnitColor(unit, units) {
  if (UNIT_COLORS[unit]) return UNIT_COLORS[unit];
  const idx = units.findIndex(u => u.name === unit);
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length] || "#9CA3AF";
}
function emptyForm() { return {guest:"",unit:"",check_in:"",check_out:"",persons:2,status:"confirmed",price:"",phone:"",source:"Direkt",notes:""}; }

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchBookings() {
  const { data, error } = await supabase.from("bookings").select("*").order("check_in", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchUnits() {
  const { data, error } = await supabase.from("units").select("*").order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function insertBooking(b) {
  const { data, error } = await supabase.from("bookings").insert([b]).select().single();
  if (error) throw error;
  return data;
}

async function updateBooking(id, b) {
  const { data, error } = await supabase.from("bookings").update(b).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

async function deleteBooking(id) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) throw error;
}

async function insertUnit(name) {
  const { data, error } = await supabase.from("units").insert([{ name }]).select().single();
  if (error) throw error;
  return data;
}

async function deleteUnit(id) {
  const { error } = await supabase.from("units").delete().eq("id", id);
  if (error) throw error;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BookingDashboard() {
  const [bookings, setBookings] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeUnit, setActiveUnit] = useState("Alle");
  const [activeStatus, setActiveStatus] = useState("Alle");
  const [tab, setTab] = useState("liste");
  const [selected, setSelected] = useState(null);
  const [formMode, setFormMode] = useState(null);
  const [formData, setFormData] = useState(emptyForm());
  const [formError, setFormError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = todayISO();

  useEffect(() => {
    load();
    // Realtime subscription – beide Nutzer sehen Änderungen sofort
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => loadBookings())
      .on("postgres_changes", { event: "*", schema: "public", table: "units" }, () => loadUnits())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [b, u] = await Promise.all([fetchBookings(), fetchUnits()]);
      setBookings(b); setUnits(u);
    } catch (e) {
      setError("Verbindung zur Datenbank fehlgeschlagen: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBookings() {
    try { setBookings(await fetchBookings()); } catch {}
  }
  async function loadUnits() {
    try { setUnits(await fetchUnits()); } catch {}
  }

  const unitNames = units.map(u => u.name);
  const filtered = bookings.filter(b =>
    (activeUnit === "Alle" || b.unit === activeUnit) &&
    (activeStatus === "Alle" || b.status === activeStatus)
  );
  const todayB = bookings.filter(b => b.check_in === today || b.check_out === today);
  const revenue = filtered.reduce((s, b) => s + Number(b.price || 0), 0);
  const checkedIn = bookings.filter(b => b.status === "checkedin").length;
  const auslastung = units.length > 0 ? Math.round((checkedIn / units.length) * 100) : 0;
  const stats = [
    { label: "Buchungen", value: filtered.length, icon: "📋" },
    { label: "Einnahmen", value: `€${revenue.toLocaleString("de")}`, icon: "💶" },
    { label: "Heute", value: todayB.length, icon: "🏠" },
    { label: "Auslastung", value: auslastung + "%", icon: "📊" },
  ];

  function openAdd() { setFormData(emptyForm()); setFormError(""); setFormMode("add"); }
  function openEdit(b) { setFormData({ ...b, check_in: b.check_in, check_out: b.check_out }); setFormError(""); setDeleteConfirm(false); setFormMode("edit"); setSelected(null); }
  function handleFormChange(f, v) { setFormData(p => ({ ...p, [f]: v })); }

  function validateForm() {
    if (!formData.guest?.trim()) return "Bitte Gastname eingeben.";
    if (!formData.unit) return "Bitte Unterkunft wählen.";
    if (!formData.check_in) return "Bitte Check-in Datum eingeben.";
    if (!formData.check_out) return "Bitte Check-out Datum eingeben.";
    if (formData.check_out <= formData.check_in) return "Check-out muss nach Check-in liegen.";
    if (!formData.price || isNaN(Number(formData.price))) return "Bitte gültigen Preis eingeben.";
    return "";
  }

  async function handleSave() {
    const err = validateForm(); if (err) { setFormError(err); return; }
    setSaving(true);
    const nights = getNights(formData.check_in, formData.check_out);
    const payload = {
      guest: formData.guest.trim(),
      unit: formData.unit,
      check_in: formData.check_in,
      check_out: formData.check_out,
      nights,
      persons: Number(formData.persons),
      status: formData.status,
      price: Number(formData.price),
      phone: formData.phone || null,
      source: formData.source,
      notes: formData.notes || null,
    };
    try {
      if (formMode === "add") {
        const newB = await insertBooking(payload);
        setBookings(prev => [...prev, newB].sort((a,b) => a.check_in.localeCompare(b.check_in)));
      } else {
        const updated = await updateBooking(formData.id, payload);
        setBookings(prev => prev.map(b => b.id === updated.id ? updated : b));
      }
      setFormMode(null);
    } catch (e) {
      setFormError("Fehler beim Speichern: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteBooking(formData.id);
      setBookings(prev => prev.filter(b => b.id !== formData.id));
      setFormMode(null); setDeleteConfirm(false);
    } catch (e) {
      setFormError("Fehler beim Löschen: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(booking, newStatus) {
    try {
      await updateBooking(booking.id, { status: newStatus });
      setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: newStatus } : b));
      setSelected(p => p ? { ...p, status: newStatus } : p);
    } catch {}
  }

  if (loading) return (
    <div style={{ ...S.root, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 32 }}>🏡</div>
      <div style={{ color: "#6B7280", fontSize: 14 }}>Lade Buchungen…</div>
    </div>
  );

  if (error) return (
    <div style={{ ...S.root, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 12, padding: 24 }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
      <div style={{ color: "#F87171", fontSize: 14, textAlign: "center" }}>{error}</div>
      <button style={{ ...S.actionBtn, ...S.actionBtnPrimary }} onClick={load}>Nochmal versuchen</button>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{css}</style>

      <div style={S.header}>
        <div>
          <div style={S.headerSub}>{new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div style={S.headerTitle}>Meine Unterkünfte</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={S.iconBtn} onClick={() => setFormMode("units")}>⚙️</button>
          <button style={S.addBtn} onClick={openAdd}>+ Buchung</button>
        </div>
      </div>

      <div style={S.tabs}>
        {["liste", "heute", "kalender"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...S.tabBtn, ...(tab === t ? S.tabActive : {}) }}>
            {t === "liste" ? "Liste" : t === "heute" ? "Heute" : "Kalender"}
          </button>
        ))}
      </div>

      {tab === "liste" && <>
        <div style={S.statsRow}>
          {stats.map(s => (
            <div key={s.label} style={S.statCard}>
              <div style={S.statIcon}>{s.icon}</div>
              <div style={S.statValue}>{s.value}</div>
              <div style={S.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={S.filterScroll}>
          {["Alle", ...unitNames].map(u => (
            <button key={u} onClick={() => setActiveUnit(u)} style={{ ...S.chip, ...(activeUnit === u ? S.chipActive : {}) }}>{u}</button>
          ))}
        </div>
        <div style={S.filterScroll}>
          {["Alle", ...Object.keys(STATUS_CONFIG)].map(s => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button key={s} onClick={() => setActiveStatus(s)} style={{ ...S.chip, ...(activeStatus === s ? (cfg ? { background: cfg.bg, color: cfg.color, borderColor: cfg.color } : S.chipActive) : {}) }}>
                {cfg ? <><span style={{ ...S.dot, background: cfg.dot }} />{cfg.label}</> : "Alle Status"}
              </button>
            );
          })}
        </div>
        <div style={S.list}>
          {filtered.length === 0
            ? <div style={S.empty}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🏡</div>
                <div style={{ fontWeight: 600, color: "#9CA3AF", marginBottom: 6 }}>Noch keine Buchungen</div>
                <div style={{ fontSize: 12, color: "#4B5563" }}>Tippe auf „+ Buchung" um loszulegen.</div>
              </div>
            : filtered.map(b => <BookingCard key={b.id} b={b} units={units} onClick={() => setSelected(b)} />)
          }
        </div>
      </>}

      {tab === "heute" && <div style={S.list}>
        <div style={S.sectionTitle}>Heute: {formatFullDate(today)}</div>
        {todayB.length === 0
          ? <div style={S.empty}>Keine Ankünfte oder Abreisen heute 🌿</div>
          : todayB.map(b => {
              const isIn = b.check_in === today;
              return (
                <div key={b.id} style={S.card} className="booking-card" onClick={() => setSelected(b)}>
                  <div style={S.cardTop}>
                    <div>
                      <div style={{ ...S.eventTag, background: isIn ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)", color: isIn ? "#4ADE80" : "#FBBF24" }}>{isIn ? "🏠 Ankunft" : "👋 Abreise"}</div>
                      <div style={S.guestName}>{b.guest}</div>
                      <div style={S.unitName}>{b.unit}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={S.price}>€{Number(b.price).toLocaleString("de")}</div>
                      <div style={S.nightsBadgeAlt}>{b.nights || getNights(b.check_in, b.check_out)} Nächte</div>
                    </div>
                  </div>
                  <div style={S.cardFooter}>
                    <span style={S.footerItem}>👥 {b.persons} Pers.</span>
                    {b.phone && <span style={S.footerItem}>📞 {b.phone}</span>}
                  </div>
                </div>
              );
            })
        }
        <div style={{ ...S.sectionTitle, marginTop: 16 }}>Aktuell eingecheckt</div>
        {bookings.filter(b => b.status === "checkedin").length === 0
          ? <div style={S.empty}>Niemand aktuell eingecheckt</div>
          : bookings.filter(b => b.status === "checkedin").map(b => (
              <div key={b.id} style={S.card} className="booking-card" onClick={() => setSelected(b)}>
                <div style={S.cardTop}>
                  <div><div style={S.guestName}>{b.guest}</div><div style={S.unitName}>{b.unit}</div></div>
                  <div style={{ textAlign: "right" }}><div style={S.dateVal}>bis {formatFullDate(b.check_out)}</div><div style={S.nightsBadgeAlt}>{b.nights || getNights(b.check_in, b.check_out)} Nächte</div></div>
                </div>
              </div>
            ))
        }
      </div>}

      {tab === "kalender" && <CalendarView bookings={bookings} units={units} today={today} />}

      {selected && (
        <BottomSheet onClose={() => setSelected(null)}>
          <DetailSheet b={selected} onEdit={() => openEdit(selected)} onStatusChange={s => handleStatusChange(selected, s)} onClose={() => setSelected(null)} />
        </BottomSheet>
      )}

      {(formMode === "add" || formMode === "edit") && (
        <BottomSheet onClose={() => setFormMode(null)} tall>
          <BookingForm
            mode={formMode} data={formData} units={unitNames} error={formError}
            deleteConfirm={deleteConfirm} saving={saving}
            onChange={handleFormChange} onSave={handleSave}
            onDelete={handleDelete} onDeleteConfirm={() => setDeleteConfirm(true)}
            onDeleteCancel={() => setDeleteConfirm(false)} onClose={() => setFormMode(null)}
          />
        </BottomSheet>
      )}

      {formMode === "units" && (
        <BottomSheet onClose={() => setFormMode(null)}>
          <UnitsManager units={units} onAdd={insertUnit} onDelete={deleteUnit} onClose={() => { loadUnits(); setFormMode(null); }} />
        </BottomSheet>
      )}
    </div>
  );
}

function BookingCard({ b, units, onClick }) {
  const cfg = STATUS_CONFIG[b.status] || STATUS_CONFIG.confirmed;
  const nights = b.nights || getNights(b.check_in, b.check_out);
  return (
    <div style={S.card} className="booking-card" onClick={onClick}>
      <div style={S.cardTop}>
        <div><div style={S.guestName}>{b.guest}</div><div style={S.unitName}>{b.unit}</div></div>
        <div style={{ textAlign: "right" }}>
          <div style={S.price}>€{Number(b.price).toLocaleString("de")}</div>
          <div style={{ ...S.statusBadge, background: cfg.bg, color: cfg.color }}><span style={{ ...S.dot, background: cfg.dot }} />{cfg.label}</div>
        </div>
      </div>
      <div style={S.cardDates}>
        <div style={S.dateBlock}><div style={S.dateLabel}>CHECK-IN</div><div style={S.dateVal}>{formatFullDate(b.check_in)}</div></div>
        <div style={S.arrowWrap}><div style={S.arrow}>→</div><div style={S.nightsBadge}>{nights}N</div></div>
        <div style={{ ...S.dateBlock, textAlign: "right" }}><div style={S.dateLabel}>CHECK-OUT</div><div style={S.dateVal}>{formatFullDate(b.check_out)}</div></div>
      </div>
      <div style={S.cardFooter}>
        <span style={S.footerItem}>👥 {b.persons} Pers.</span>
        <span style={S.footerItem}>📌 {b.source}</span>
        {b.notes ? <span style={S.footerNote}>📝 {b.notes}</span> : null}
      </div>
    </div>
  );
}

function DetailSheet({ b, onEdit, onStatusChange, onClose }) {
  const [showStatus, setShowStatus] = useState(false);
  const nights = b.nights || getNights(b.check_in, b.check_out);
  const cfg = STATUS_CONFIG[b.status] || STATUS_CONFIG.confirmed;
  return (
    <>
      <div style={S.modalHeader}>
        <div><div style={S.modalGuest}>{b.guest}</div><div style={S.unitName}>{b.unit}</div></div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={S.modalDates}>
        <div style={S.modalDateBlock}><div style={S.dateLabel}>CHECK-IN</div><div style={S.modalDateVal}>{formatDate(b.check_in)}</div></div>
        <div style={S.modalNights}>{nights} Nächte</div>
        <div style={{ ...S.modalDateBlock, textAlign: "right" }}><div style={S.dateLabel}>CHECK-OUT</div><div style={S.modalDateVal}>{formatDate(b.check_out)}</div></div>
      </div>
      <div style={S.detailGrid}>
        {[["Personen", `${b.persons} Pers.`], ["Preis gesamt", `€${Number(b.price).toLocaleString("de")}`], ["Quelle", b.source], b.phone && ["Telefon", b.phone]].filter(Boolean).map(([k, v]) => (
          <div key={k} style={S.detailRow}><div style={S.detailKey}>{k}</div><div style={S.detailVal}>{v}</div></div>
        ))}
        <div style={{ ...S.detailRow, borderBottom: "none" }}>
          <div style={S.detailKey}>Status</div>
          <div style={{ ...S.statusBadge, background: cfg.bg, color: cfg.color, justifyContent: "flex-end" }}><span style={{ ...S.dot, background: cfg.dot }} />{cfg.label}</div>
        </div>
      </div>
      {b.notes && <div style={S.notesBox}><div style={S.dateLabel}>NOTIZEN</div><div style={S.notesText}>{b.notes}</div></div>}
      {showStatus && (
        <div style={S.statusPicker}>
          <div style={{ ...S.dateLabel, marginBottom: 10 }}>STATUS ÄNDERN</div>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button key={key} style={{ ...S.statusPickerBtn, ...(b.status === key ? { color: cfg.color } : {}) }}
              onClick={() => { onStatusChange(key); setShowStatus(false); }}>
              <span style={{ ...S.dot, background: cfg.dot }} />{cfg.label}
            </button>
          ))}
        </div>
      )}
      <div style={S.modalActions}>
        <button style={S.actionBtn} onClick={() => setShowStatus(!showStatus)}>🔄 Status</button>
        <button style={{ ...S.actionBtn, ...S.actionBtnPrimary }} onClick={onEdit}>✏️ Bearbeiten</button>
      </div>
    </>
  );
}

function BookingForm({ mode, data, units, error, deleteConfirm, saving, onChange, onSave, onDelete, onDeleteConfirm, onDeleteCancel, onClose }) {
  const nights = getNights(data.check_in, data.check_out);
  return (
    <>
      <div style={S.modalHeader}>
        <div style={S.modalGuest}>{mode === "add" ? "Neue Buchung" : "Buchung bearbeiten"}</div>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={S.formScroll}>
        <Field label="GASTNAME *"><input style={S.input} value={data.guest} onChange={e => onChange("guest", e.target.value)} placeholder="z.B. Familie Müller" /></Field>
        <Field label="UNTERKUNFT *">
          <select style={S.input} value={data.unit} onChange={e => onChange("unit", e.target.value)}>
            <option value="">– wählen –</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="CHECK-IN *"><input style={S.input} type="date" value={data.check_in} onChange={e => onChange("check_in", e.target.value)} /></Field>
          <Field label="CHECK-OUT *"><input style={S.input} type="date" value={data.check_out} onChange={e => onChange("check_out", e.target.value)} /></Field>
        </div>
        {nights > 0 && <div style={S.nightsInfo}>🌙 {nights} Nacht{nights !== 1 ? "e" : ""}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="PERSONEN"><input style={S.input} type="number" min="1" max="20" value={data.persons} onChange={e => onChange("persons", e.target.value)} /></Field>
          <Field label="PREIS (€) *"><input style={S.input} type="number" min="0" value={data.price} onChange={e => onChange("price", e.target.value)} placeholder="0" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="STATUS">
            <select style={S.input} value={data.status} onChange={e => onChange("status", e.target.value)}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="QUELLE">
            <select style={S.input} value={data.source} onChange={e => onChange("source", e.target.value)}>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="TELEFON"><input style={S.input} type="tel" value={data.phone || ""} onChange={e => onChange("phone", e.target.value)} placeholder="+43 …" /></Field>
        <Field label="NOTIZEN"><textarea style={{ ...S.input, minHeight: 72, resize: "vertical" }} value={data.notes || ""} onChange={e => onChange("notes", e.target.value)} placeholder="Besondere Wünsche…" /></Field>
        {error && <div style={S.formError}>{error}</div>}
        <div style={S.modalActions}>
          {mode === "edit" && !deleteConfirm && (
            <button style={{ ...S.actionBtn, color: "#F87171", borderColor: "#7F1D1D" }} onClick={onDeleteConfirm}>🗑 Löschen</button>
          )}
          {deleteConfirm && (
            <div style={S.deleteConfirmBox}>
              <div style={{ fontSize: 13, color: "#F87171", marginBottom: 10 }}>Buchung wirklich löschen?</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...S.actionBtn, flex: 1 }} onClick={onDeleteCancel}>Abbrechen</button>
                <button style={{ ...S.actionBtn, flex: 1, background: "#7F1D1D", color: "#FCA5A5", border: "none" }} onClick={onDelete} disabled={saving}>Ja, löschen</button>
              </div>
            </div>
          )}
          {!deleteConfirm && (
            <button style={{ ...S.actionBtn, ...S.actionBtnPrimary, flex: 1, opacity: saving ? 0.7 : 1 }} onClick={onSave} disabled={saving}>
              {saving ? "Speichert…" : mode === "add" ? "✅ Speichern" : "✅ Aktualisieren"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 12 }}><div style={{ ...S.dateLabel, marginBottom: 5 }}>{label}</div>{children}</div>;
}

function UnitsManager({ units, onAdd, onDelete, onClose }) {
  const [newUnit, setNewUnit] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    const n = newUnit.trim();
    if (!n || units.find(u => u.name === n)) return;
    setSaving(true);
    try { await onAdd(n); setNewUnit(""); } catch {}
    setSaving(false);
  }

  async function remove(u) {
    if (!confirm(`„${u.name}" wirklich löschen?`)) return;
    try { await onDelete(u.id); } catch {}
  }

  return (
    <>
      <div style={S.modalHeader}><div style={S.modalGuest}>Unterkünfte verwalten</div><button style={S.closeBtn} onClick={onClose}>✕</button></div>
      <div style={S.formScroll}>
        {units.map(u => (
          <div key={u.id} style={S.unitRow}>
            <span style={{ ...S.unitDot, background: UNIT_COLORS[u.name] || "#6366F1" }} />
            <span style={{ flex: 1, fontSize: 14, color: "#F9FAFB" }}>{u.name}</span>
            <button style={S.unitRemoveBtn} onClick={() => remove(u)}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <input style={{ ...S.input, flex: 1 }} placeholder="Neue Unterkunft…" value={newUnit} onChange={e => setNewUnit(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
          <button style={{ ...S.actionBtn, ...S.actionBtnPrimary, padding: "0 16px", whiteSpace: "nowrap", opacity: saving ? 0.7 : 1 }} onClick={add} disabled={saving}>+ Add</button>
        </div>
        <button style={{ ...S.actionBtn, ...S.actionBtnPrimary, width: "100%", marginTop: 16 }} onClick={onClose}>✅ Fertig</button>
      </div>
    </>
  );
}

function BottomSheet({ children, onClose, tall }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, ...(tall ? { maxHeight: "92vh" } : { maxHeight: "85vh" }) }} onClick={e => e.stopPropagation()}>
        <div style={S.modalHandle} />
        {children}
      </div>
    </div>
  );
}

function CalendarView({ bookings, units, today }) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  function prevMonth() { const d = new Date(y, m - 2, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  function nextMonth() { const d = new Date(y, m, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  return (
    <div style={{ padding: "0 16px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button style={S.navBtn} onClick={prevMonth}>‹</button>
        <div style={S.sectionTitle}>{monthName}</div>
        <button style={S.navBtn} onClick={nextMonth}>›</button>
      </div>
      <div style={S.calendarLegend}>
        {units.map(u => (
          <div key={u.id} style={S.legendItem}>
            <span style={{ ...S.legendDot, background: getUnitColor(u.name, units) }} />
            <span style={S.legendLabel}>{u.name}</span>
          </div>
        ))}
      </div>
      <div style={S.calendarGrid}>
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => <div key={d} style={S.calHead}>{d}</div>)}
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {days.map(day => {
          const dayNum = parseInt(day.split("-")[2]);
          const hits = bookings.filter(b => b.check_in <= day && b.check_out > day);
          const isToday = day === today;
          return (
            <div key={day} style={{ ...S.calCell, ...(isToday ? S.calToday : {}) }}>
              <span style={S.calDayNum}>{dayNum}</span>
              <div style={S.calDots}>
                {hits.map(b => <span key={b.id} style={{ ...S.calDot, background: getUnitColor(b.unit, units) }} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  root: { background: "#0F1117", minHeight: "100vh", fontFamily: "'DM Sans',sans-serif", color: "#F1F1F1", maxWidth: 430, margin: "0 auto", paddingBottom: 48 },
  header: { padding: "52px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  headerSub: { fontSize: 11, color: "#6B7280", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 },
  headerTitle: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "#F9FAFB" },
  iconBtn: { background: "#1F2937", border: "1px solid #374151", borderRadius: 10, width: 36, height: 36, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
  addBtn: { background: "linear-gradient(135deg,#6366F1,#8B5CF6)", border: "none", borderRadius: 10, padding: "8px 14px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", whiteSpace: "nowrap" },
  tabs: { display: "flex", gap: 4, padding: "0 16px 16px" },
  tabBtn: { flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid #1F2937", background: "transparent", color: "#6B7280", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" },
  tabActive: { background: "#1F2937", color: "#F9FAFB", borderColor: "#374151" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "0 16px 16px" },
  statCard: { background: "#161B27", borderRadius: 12, padding: "10px 6px", textAlign: "center", border: "1px solid #1F2937" },
  statIcon: { fontSize: 16, marginBottom: 4 },
  statValue: { fontSize: 14, fontWeight: 700, color: "#F9FAFB", lineHeight: 1.2 },
  statLabel: { fontSize: 10, color: "#6B7280", marginTop: 2 },
  filterScroll: { display: "flex", gap: 8, overflowX: "auto", padding: "0 16px 12px", scrollbarWidth: "none" },
  chip: { whiteSpace: "nowrap", padding: "6px 12px", borderRadius: 20, border: "1px solid #1F2937", background: "transparent", color: "#9CA3AF", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 },
  chipActive: { background: "rgba(255,255,255,0.1)", color: "#F9FAFB", borderColor: "#374151" },
  dot: { width: 6, height: 6, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  list: { padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#161B27", borderRadius: 16, padding: "14px 16px", border: "1px solid #1F2937", cursor: "pointer" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  guestName: { fontSize: 15, fontWeight: 600, color: "#F9FAFB", marginBottom: 2 },
  unitName: { fontSize: 12, color: "#6B7280" },
  price: { fontSize: 15, fontWeight: 700, color: "#F9FAFB", marginBottom: 4 },
  statusBadge: { fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" },
  cardDates: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0F1117", borderRadius: 10, padding: "10px 14px", marginBottom: 10 },
  dateBlock: { flex: 1 },
  dateLabel: { fontSize: 10, color: "#4B5563", letterSpacing: "0.06em", marginBottom: 2, textTransform: "uppercase" },
  dateVal: { fontSize: 13, fontWeight: 600, color: "#D1D5DB" },
  arrowWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3 },
  arrow: { color: "#4B5563", fontSize: 14 },
  nightsBadge: { fontSize: 10, color: "#6366F1", fontWeight: 700, background: "rgba(99,102,241,0.12)", padding: "2px 6px", borderRadius: 20 },
  cardFooter: { display: "flex", gap: 10, flexWrap: "wrap" },
  footerItem: { fontSize: 11, color: "#6B7280" },
  footerNote: { fontSize: 11, color: "#9CA3AF", background: "#1F2937", padding: "2px 8px", borderRadius: 8, flex: "0 0 100%", marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, marginTop: 4 },
  empty: { color: "#4B5563", textAlign: "center", padding: "40px 0", fontSize: 14, lineHeight: 1.8 },
  eventTag: { fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, display: "inline-block", marginBottom: 4 },
  nightsBadgeAlt: { fontSize: 12, color: "#6366F1", fontWeight: 600, marginTop: 4 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 100, display: "flex", alignItems: "flex-end" },
  modal: { background: "#161B27", borderRadius: "20px 20px 0 0", padding: "12px 20px 40px", width: "100%", border: "1px solid #1F2937", borderBottom: "none", animation: "slideUp 0.25s ease", overflowY: "auto" },
  modalHandle: { width: 40, height: 4, background: "#374151", borderRadius: 2, margin: "0 auto 20px" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  modalGuest: { fontSize: 20, fontWeight: 700, color: "#F9FAFB", marginBottom: 2 },
  closeBtn: { background: "#1F2937", border: "none", color: "#9CA3AF", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontFamily: "'DM Sans',sans-serif", flexShrink: 0 },
  modalDates: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0F1117", borderRadius: 12, padding: "14px 18px", marginBottom: 16 },
  modalDateBlock: { flex: 1 },
  modalDateVal: { fontSize: 18, fontWeight: 700, color: "#F9FAFB" },
  modalNights: { fontSize: 12, color: "#6366F1", fontWeight: 700, background: "rgba(99,102,241,0.12)", padding: "4px 10px", borderRadius: 20, textAlign: "center" },
  detailGrid: { display: "flex", flexDirection: "column", gap: 0, marginBottom: 12, borderRadius: 12, overflow: "hidden", border: "1px solid #1F2937" },
  detailRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: "1px solid #1F2937", background: "#161B27" },
  detailKey: { fontSize: 13, color: "#6B7280" },
  detailVal: { fontSize: 13, color: "#F9FAFB", fontWeight: 500 },
  notesBox: { background: "#0F1117", borderRadius: 10, padding: "10px 14px", marginBottom: 16 },
  notesText: { fontSize: 13, color: "#D1D5DB", marginTop: 4 },
  statusPicker: { background: "#0F1117", borderRadius: 12, padding: "12px 14px", marginBottom: 12 },
  statusPickerBtn: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 0", background: "transparent", border: "none", borderBottom: "1px solid #1F2937", color: "#D1D5DB", fontSize: 14, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" },
  modalActions: { display: "flex", gap: 10, marginTop: 16 },
  actionBtn: { flex: 1, padding: "12px", borderRadius: 12, border: "1px solid #374151", background: "#1F2937", color: "#D1D5DB", fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" },
  actionBtnPrimary: { background: "linear-gradient(135deg,#6366F1,#8B5CF6)", border: "none", color: "#fff" },
  formScroll: { overflowY: "auto" },
  input: { width: "100%", background: "#0F1117", border: "1px solid #374151", borderRadius: 10, padding: "10px 12px", color: "#F9FAFB", fontSize: 14, fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box" },
  nightsInfo: { background: "rgba(99,102,241,0.1)", color: "#818CF8", fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "6px 12px", marginBottom: 12, textAlign: "center" },
  formError: { background: "rgba(239,68,68,0.1)", color: "#F87171", fontSize: 13, borderRadius: 8, padding: "8px 12px", marginBottom: 8, border: "1px solid rgba(239,68,68,0.2)" },
  deleteConfirmBox: { background: "rgba(127,29,29,0.2)", borderRadius: 10, padding: "12px", border: "1px solid rgba(239,68,68,0.2)", flex: 1 },
  unitRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1F2937" },
  unitDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  unitRemoveBtn: { background: "transparent", border: "none", color: "#6B7280", cursor: "pointer", fontSize: 14, padding: "4px" },
  navBtn: { background: "#1F2937", border: "1px solid #374151", borderRadius: 8, width: 32, height: 32, color: "#9CA3AF", cursor: "pointer", fontSize: 18, fontFamily: "'DM Sans',sans-serif" },
  calendarLegend: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  legendLabel: { fontSize: 11, color: "#9CA3AF" },
  calendarGrid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  calHead: { fontSize: 10, color: "#4B5563", textAlign: "center", padding: "4px 0", fontWeight: 600, letterSpacing: "0.04em" },
  calCell: { background: "#161B27", borderRadius: 8, padding: "6px 4px 4px", minHeight: 46, border: "1px solid #1F2937", display: "flex", flexDirection: "column", alignItems: "center" },
  calToday: { border: "1px solid #6366F1", background: "rgba(99,102,241,0.08)" },
  calDayNum: { fontSize: 11, color: "#9CA3AF", marginBottom: 3 },
  calDots: { display: "flex", flexWrap: "wrap", gap: 2, justifyContent: "center" },
  calDot: { width: 5, height: 5, borderRadius: "50%" },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#0F1117;}
  .booking-card:active{transform:scale(0.98);border-color:#374151!important;}
  ::-webkit-scrollbar{display:none;}
  input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.5);}
  select option{background:#161B27;color:#F9FAFB;}
  @keyframes slideUp{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}
`;
