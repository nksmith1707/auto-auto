// Business (fleet) account: create it, then vehicles, visits, add-on approvals, invoices, and account settings.
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtWhen } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { Button, Card, Checkbox, Chips, Field, Notice, Screen, T, errorParts, useTheme } from "../../../shared/ui";
import { TopBar } from "../components/TopBar";
import { FLEET_STATUS, Pill, RUN_STATUS, VEHICLE_STATUS } from "../components/Fleet";

const AUTO = [[0, "Ask me"], [5000, "$50"], [7500, "$75"], [10000, "$100"], [15000, "$150"]];

function Row({ onPress, children, testID }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: pressed ? t.c.brand : t.c.line, borderRadius: 14, padding: 12, backgroundColor: t.c.surface, gap: 4 })}>
      {children}
    </Pressable>
  );
}

function CreateForm({ onDone }) {
  const t = useTheme();
  const { call, user } = useAuth();
  const [f, setF] = useState({ name: "", managerName: `${user.firstName} ${user.lastName}`, billingEmail: "", yardStreet: "", yardCity: "", yardState: "TN", yardZip: "", yardHours: "", checkinNotes: "", terms: "net30", autoApproveCents: 7500, poRequired: false });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => (e && e.fields && e.fields[k] ? { ...e, fields: { ...e.fields, [k]: undefined } } : e)); };
  const { message, fields } = errorParts(err);
  async function go() {
    setBusy(true); setErr(null);
    try { onDone(await call("createFleet", f)); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 14 }}>
      <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>Business account</T>
      <T v="muted" style={{ textAlign: "center" }}>Keep work vehicles running without shop runs. A partner comes to your lot, services several vehicles in one visit, and you get one invoice.</T>
      <Field label="Company name" value={f.name} onChangeText={set("name")} error={fields.name} testID="fl-name" />
      <Field label="Fleet manager" value={f.managerName} onChangeText={set("managerName")} error={fields.managerName} testID="fl-mgr" />
      <Field label="Billing email (for invoices)" value={f.billingEmail} onChangeText={set("billingEmail")} error={fields.billingEmail} keyboardType="email-address" autoCapitalize="none" testID="fl-email" />
      <Field label="Yard address" value={f.yardStreet} onChangeText={set("yardStreet")} error={fields.yardStreet} hint="Where your vehicles are parked. It's a business address, so partners see it when they look at a visit." testID="fl-street" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Field style={{ flex: 2 }} label="City" value={f.yardCity} onChangeText={set("yardCity")} error={fields.yardCity} testID="fl-city" />
        <Field style={{ flex: 1 }} label="State" value={f.yardState} onChangeText={set("yardState")} error={fields.yardState} autoCapitalize="characters" maxLength={2} />
        <Field style={{ flex: 1.3 }} label="ZIP" value={f.yardZip} onChangeText={set("yardZip")} error={fields.yardZip} keyboardType="number-pad" maxLength={5} testID="fl-zip" />
      </View>
      <Field label="Yard hours" value={f.yardHours} onChangeText={set("yardHours")} error={fields.yardHours} placeholder="Mon–Fri, 6 AM – 6 PM" testID="fl-hours" />
      <Field label="Check-in and keys" value={f.checkinNotes} onChangeText={set("checkinNotes")} error={fields.checkinNotes} multiline placeholder="Where to check in, where the keys are, anything partners shouldn't move" testID="fl-checkin" />
      <Chips label="Payment terms" value={f.terms} onChange={set("terms")} options={[["net30", "Net 30 invoice"], ["card", "Card on file"]]} testID="fl-terms" />
      <T v="hint">Net 30 needs a quick business credit check, usually 1 business day. Card on file starts right away; each visit's invoice is charged to your card.</T>
      <Chips label="Approve add-ons automatically up to (per vehicle)" value={f.autoApproveCents} onChange={set("autoApproveCents")} options={AUTO} testID="fl-auto" />
      <Checkbox checked={f.poRequired} onChange={set("poRequired")}>Require a PO number on every request</Checkbox>
      <Card style={{ gap: 4, backgroundColor: t.c.brandSoft, borderColor: t.c.brandSoft }}>
        <T v="small" style={{ fontFamily: t.f.bodyB }}>Fleet pricing</T>
        <T v="small">Book time × $85/hr (instead of $100), parts at cost + 10%, and one $25 trip fee per visit instead of a mobile fee on every vehicle.</T>
      </Card>
      {message ? <Notice tone="bad">{message}</Notice> : null}
      <Button title="Create business account" onPress={go} loading={busy} testID="fl-create" />
    </View>
  );
}

export default function Fleet() {
  const t = useTheme();
  const router = useRouter();
  const { call } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("vehicles");
  const [busy, setBusy] = useState(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  const load = useCallback(async () => { try { setD(await call("fleet")); setErr(null); } catch (e) { setErr(e.message); } }, [call]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function decide(id, approve) {
    setBusy(id);
    try { setD(await call("fleetAddonDecision", id, approve)); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }
  async function saveAccount(patch) {
    setBusy("acct");
    try { setD(await call("updateFleet", patch)); setErr(null); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  if (!d) return <Screen><TopBar onBack={back} />{err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={t.c.brand} style={{ marginTop: 40 }} />}</Screen>;
  if (!d.fleet) return <Screen contentStyle={{ paddingBottom: 32 }}><TopBar onBack={back} /><CreateForm onDone={setD} /></Screen>;

  const f = d.fleet;
  const pending = d.approvals.filter((a) => a.status === "pending");
  const due = d.vehicles.filter((v) => v.status !== "ok").length;
  const canRequest = f.status === "active" && d.vehicles.length > 0;
  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <TopBar onBack={back} />
      <View style={{ gap: 14 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <T v="h1" accessibilityRole="header" style={{ textAlign: "center" }}>{f.name}</T>
          <Pill tone={FLEET_STATUS[f.status][1]} testID="fleet-status">{FLEET_STATUS[f.status][0]}</Pill>
        </View>
        {f.status === "review" ? (
          <Notice>We're checking your business credit for net 30 terms, usually within 1 business day. You can add vehicles now. Requests open once you're approved, or switch to card on file to start today.</Notice>
        ) : null}
        {f.status === "declined" || f.status === "paused" ? <Notice tone="bad">{f.decisionNote || "Contact support about your account."}</Notice> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[[d.vehicles.length, "vehicles"], [due, "due for service"], [money(d.openInvoicesCents, { always: true }), "open invoices"]].map(([n, l]) => (
            <Card key={l} style={{ flex: 1, alignItems: "center", paddingVertical: 10, gap: 0 }}>
              <Text style={{ fontFamily: t.f.displayX, fontSize: 18, color: t.c.ink }}>{n}</Text>
              <T v="hint" style={{ textAlign: "center" }}>{l}</T>
            </Card>
          ))}
        </View>
        <Chips value={tab} onChange={setTab} testID="fleet-tabs"
          options={[["vehicles", "Vehicles"], ["visits", "Visits"], ["approvals", `Approvals${pending.length ? ` (${pending.length})` : ""}`], ["invoices", "Invoices"], ["account", "Account"]]} />

        {tab === "vehicles" ? (
          <View style={{ gap: 8 }}>
            {d.vehicles.map((v) => (
              <Row key={v.id} onPress={() => router.push({ pathname: "/fleet-log", params: { id: v.id } })} testID="fleet-vehicle">
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T style={{ fontFamily: t.f.bodyX }}>{v.unit}</T>
                  <Pill tone={VEHICLE_STATUS[v.status][1]}>{VEHICLE_STATUS[v.status][0]}</Pill>
                </View>
                <T v="small">{v.year} {v.make} {v.model} · {v.classLabel}</T>
                <T v="hint">{[v.plate, v.mileage != null ? `${v.mileage.toLocaleString("en-US")} mi` : null, v.nextOilMiles ? `next oil ${v.nextOilMiles.toLocaleString("en-US")}` : null, v.dotDue ? `DOT due ${v.dotDue}` : null].filter(Boolean).join(" · ")}</T>
              </Row>
            ))}
            {!d.vehicles.length ? <T v="muted" style={{ textAlign: "center" }}>No vehicles yet.</T> : null}
            <Button title="+ Add a vehicle" variant="ghost" onPress={() => router.push("/fleet-vehicle")} testID="add-fleet-vehicle" />
          </View>
        ) : null}

        {tab === "visits" ? (
          <View style={{ gap: 8 }}>
            <Button title={canRequest ? "Request fleet service" : f.status !== "active" ? "Requests open after approval" : "Add a vehicle first"} onPress={() => router.push("/fleet-request")} disabled={!canRequest} testID="fleet-request" />
            {d.runs.map((r) => (
              <Row key={r.id} onPress={() => router.push({ pathname: "/fleet-run", params: { id: r.id } })} testID="fleet-run-row">
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T style={{ fontFamily: t.f.bodyX }}>#{r.number} · {r.vehicles} vehicle{r.vehicles === 1 ? "" : "s"}</T>
                  <T style={{ fontFamily: t.f.bodyB }}>{money(r.estimateCents, { always: true })}</T>
                </View>
                <T v="small">{fmtWhen(r.windowStart)} · {r.services.join(", ")}</T>
                <Pill tone={RUN_STATUS[r.status][1]}>{r.status === "active" ? `In progress · ${r.done} of ${r.vehicles} done` : r.status === "claimed" && r.partner ? `Confirmed · ${r.partner}` : RUN_STATUS[r.status][0]}</Pill>
              </Row>
            ))}
            {!d.runs.length ? <T v="muted" style={{ textAlign: "center" }}>No visits yet.</T> : null}
          </View>
        ) : null}

        {tab === "approvals" ? (
          <View style={{ gap: 8 }}>
            {d.approvals.map((a) => (
              <Card key={a.id} style={{ gap: 6 }} testID="fleet-approval">
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T style={{ fontFamily: t.f.bodyX, flex: 1 }}>{a.unit} · {a.name}</T>
                  <T style={{ fontFamily: t.f.bodyX }}>{money(a.priceCents, { always: true })}</T>
                </View>
                <T v="hint">Visit #{a.runNumber}{a.autoApproved ? " · approved automatically (under your limit)" : ""}</T>
                <T v="small">{a.reason}</T>
                {a.status === "pending" ? (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Button style={{ flex: 1 }} title="Approve" onPress={() => decide(a.id, true)} loading={busy === a.id} testID="fleet-approve" />
                    <Button style={{ flex: 1 }} title="Decline" variant="ghost" onPress={() => decide(a.id, false)} />
                  </View>
                ) : <Pill tone={a.status === "approved" ? "ok" : "muted"}>{a.status === "approved" ? "Approved" : "Declined"}</Pill>}
              </Card>
            ))}
            {!d.approvals.length ? <T v="muted" style={{ textAlign: "center" }}>Nothing waiting for approval.</T> : null}
            <T v="hint" style={{ textAlign: "center" }}>Add-ons up to {money(f.autoApproveCents, { always: true })} per vehicle are approved automatically and show on the invoice.</T>
          </View>
        ) : null}

        {tab === "invoices" ? (
          <View style={{ gap: 8 }}>
            {d.invoices.map((i) => (
              <Row key={i.id} onPress={() => router.push({ pathname: "/fleet-invoice", params: { id: i.id } })} testID="fleet-invoice-row">
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T style={{ fontFamily: t.f.bodyX }}>INV-{i.number}</T>
                  <T style={{ fontFamily: t.f.bodyX }}>{money(i.totalCents, { always: true })}</T>
                </View>
                <T v="hint">Issued {new Date(i.issuedAt).toLocaleDateString("en-US")} · due {new Date(i.dueAt).toLocaleDateString("en-US")}{i.po ? ` · ${i.po}` : ""}</T>
                <Pill tone={i.status === "paid" ? "ok" : i.pastDue ? "bad" : "warn"}>{i.status === "paid" ? "Paid" : i.pastDue ? "Past due" : "Open"}</Pill>
              </Row>
            ))}
            {!d.invoices.length ? <T v="muted" style={{ textAlign: "center" }}>No invoices yet. You get one after each visit.</T> : null}
          </View>
        ) : null}

        {tab === "account" ? (
          <View style={{ gap: 10 }}>
            <Card style={{ gap: 6 }}>
              {[["Terms", f.terms === "net30" ? `Net 30${f.status === "active" ? ` · ${money(f.creditLimitCents, { always: true })} limit, ${money(d.creditAvailableCents, { always: true })} available` : ""}` : "Card on file"],
                ["Rates", `Book time × $${f.laborRate}/hr · parts at cost + ${d.rates.partsMarkupPct}% · ${money(d.rates.tripFeeCents, { always: true })} per visit`],
                ["Yard", `${f.yard.street}, ${f.yard.city}, ${f.yard.state} ${f.yard.zip}`], ["Hours", f.yardHours], ["Check-in", f.checkinNotes], ["Billing", f.billingEmail], ["Manager", f.managerName]].map(([k, v]) => (
                <View key={k} style={{ gap: 1 }}><Text style={t.text.label}>{k}</Text><T v="small">{v}</T></View>
              ))}
            </Card>
            <Chips label="Approve add-ons automatically up to (per vehicle)" value={f.autoApproveCents} onChange={(v) => saveAccount({ autoApproveCents: v })} options={AUTO} />
            <Checkbox checked={f.poRequired} onChange={(v) => saveAccount({ poRequired: v })}>Require a PO number on every request</Checkbox>
            {f.terms === "net30" ? <Button title="Switch to card on file" variant="ghost" onPress={() => saveAccount({ terms: "card" })} loading={busy === "acct"} testID="fleet-to-card" />
              : <Button title="Apply for net 30 terms" variant="ghost" onPress={() => saveAccount({ terms: "net30" })} loading={busy === "acct"} />}
            {f.terms === "card" && d.hasCard === false ? <Notice>Add a card before requesting service. <Text style={{ color: t.c.brand, fontFamily: t.f.bodyB }} onPress={() => router.push("/cards")}>Add a card ›</Text></Notice> : null}
          </View>
        ) : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}
      </View>
    </Screen>
  );
}
