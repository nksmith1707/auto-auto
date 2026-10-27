// Payouts: balance, schedule (weekly, then daily after 10 jobs), instant cash-out, and where the money goes.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { money } from "../../../shared/api";
import { fmtWhen } from "../../../shared/format";
import { useAuth } from "../../../shared/session";
import { openStripePage } from "../../../shared/stripePage";
import { Button, Checkbox, Notice, Screen } from "../../../shared/ui";
import { HeroFade } from "../components/Backdrops";
import { TopBar } from "../components/TopBar";
import { fonts, p } from "../theme";

const KIND = { earnings: "Job earnings", parts: "Parts reimbursed", fee_share: "Fee share", reserve: "Reserve held", reserve_release: "Reserve paid back", payout: "Payout", cashout_fee: "Cash-out fee", adjustment: "Adjustment" };
const label = { fontFamily: fonts.bodyX, fontSize: 12, letterSpacing: 0.72, color: p.muted, textTransform: "uppercase" };
const card = { backgroundColor: p.panel, borderWidth: 1, borderColor: p.line, borderRadius: 18, padding: 16, gap: 8 };

function Line({ left, right, color, sub }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bodyB, fontSize: 14, color: p.ink }}>{left}</Text>
        {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: p.muted }}>{sub}</Text> : null}
      </View>
      <Text style={{ fontFamily: fonts.displayX, fontSize: 15, color: color || p.ink }}>{right}</Text>
    </View>
  );
}

// The two tax statements from the application (Payouts & taxes step).
function TaxStatements({ call }) {
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { call("onboarding").then((s) => setA(s.answers.payouts || {})).catch(() => {}); }, [call]);
  if (!a) return null;
  const set = (k) => async (v) => {
    setA((x) => ({ ...x, [k]: v }));
    try { await call("saveStep", "payouts", { [k]: v }); setErr(null); } catch (e) { setErr(e.message); }
  };
  return (
    <View style={card}>
      <Text style={label}>Taxes</Text>
      <Checkbox checked={!!a.tax1099} onChange={set("tax1099")} testID="f-tax1099">I understand I'm an independent business. Auto-Auto doesn't withhold taxes, and I'll get a 1099 tax form from Stripe if my earnings meet IRS reporting thresholds.</Checkbox>
      <Checkbox checked={!!a.tips} onChange={set("tips")} testID="f-tips">I understand I receive 100% of customer tips.</Checkbox>
      {err ? <Notice tone="bad">{err}</Notice> : null}
    </View>
  );
}

export default function Payouts() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { call } = useAuth();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/home"));

  const load = useCallback(async (sync) => {
    try { setInfo(await call(sync ? "syncPayouts" : "payouts")); setErr(null); } catch (e) { setErr(e.message); }
  }, [call]);
  useEffect(() => { load(!!params.done); }, [load, params.done]);

  async function setup() {
    setErr(null);
    setBusy("setup");
    try {
      await openStripePage("/payouts", (returnUrl) => call("payoutSetup", returnUrl));
      await load(true);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  async function cashOut() {
    setErr(null);
    setBusy("cash");
    try {
      const r = await call("cashOut");
      setInfo(r);
      setNote(`${money(r.amountCents, { always: true })} is on its way. It usually arrives within 30 minutes.`);
      setConfirm(false);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  if (!info) {
    return (
      <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }}>
        <TopBar onBack={back} title="Payouts" />
        {err ? <Notice tone="bad">{err}</Notice> : <ActivityIndicator color={p.brand} style={{ marginTop: 40 }} />}
      </Screen>
    );
  }

  const b = info.balance;
  const s = info.schedule;
  const reserve = s.jobsDone < s.dailyAfter ? Math.round(b.availableCents * s.reservePct / 100) : 0;
  const instantGets = b.availableCents - reserve - s.instantFeeCents;
  return (
    <Screen background={<HeroFade />} style={{ backgroundColor: p.bg }} contentStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={p.ink} onRefresh={async () => { setRefreshing(true); await load(info.account.connected && !info.account.payoutsEnabled); setRefreshing(false); }} />}>
      <TopBar onBack={back} title="Payouts" />
      <View style={{ gap: 14 }}>
        <View style={[card, { alignItems: "center", paddingVertical: 22 }]}>
          <Text style={label}>Balance</Text>
          <Text style={{ fontFamily: fonts.displayH, fontSize: 40, color: p.money }} testID="balance">{money(b.availableCents, { always: true })}</Text>
          {b.reserveCents ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: p.muted }}>{money(b.reserveCents, { always: true })} held in reserve</Text> : null}
          <Text style={{ fontFamily: fonts.bodyB, fontSize: 13, color: p.brandText, textAlign: "center" }}>
            {s.time}{s.kind === "weekly" ? ` · daily after ${s.dailyAfter} jobs (${s.jobsDone} done)` : ""}
          </Text>
        </View>

        {!info.enabled ? <Notice>Payouts aren't turned on yet. Your earnings are still recorded here.</Notice> : !info.account.payoutsEnabled ? (
          <View style={card}>
            <Text style={{ fontFamily: fonts.displayX, fontSize: 18, color: p.ink }}>{info.account.connected ? "Finish payout setup" : "Set up payouts"}</Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.muted }}>
              Stripe, our payment processor, pays you. They'll ask for your bank account or debit card and the details the IRS requires. Auto-Auto never sees your bank numbers.
            </Text>
            <Button title={info.account.connected ? "Continue setup" : "Set up payouts"} variant="money" onPress={setup} loading={busy === "setup"} testID="payout-setup" />
          </View>
        ) : (
          <View style={card}>
            <Line left="Payouts" right="On" color={p.ok} sub="Paid to the account you added with Stripe" />
            {confirm ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: p.ink }}>
                  Cash out {money(Math.max(0, instantGets), { always: true })} now? That's your balance minus the {money(s.instantFeeCents, { always: true })} fee{reserve ? ` and the ${s.reservePct}% new-partner reserve (${money(reserve, { always: true })})` : ""}.
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button style={{ flex: 1 }} title="Not now" variant="ghost" onPress={() => setConfirm(false)} />
                  <Button style={{ flex: 1 }} title="Cash out" variant="money" onPress={cashOut} loading={busy === "cash"} testID="cash-out-confirm" />
                </View>
              </View>
            ) : (
              <Button title={`Cash out now (${money(s.instantFeeCents, { always: true })} fee)`} variant="money" onPress={() => setConfirm(true)} disabled={instantGets <= 0} testID="cash-out" />
            )}
          </View>
        )}

        <TaxStatements call={call} />

        {note ? <Notice tone="ok">{note}</Notice> : null}
        {err ? <Notice tone="bad">{err}</Notice> : null}

        {s.kind === "weekly" && s.reservePct ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: p.muted }}>
            New partners: {s.reservePct}% of each payout is held in reserve until daily payouts unlock, then it's paid back to you.
          </Text>
        ) : null}

        {info.activity.length ? (
          <View style={card}>
            <Text style={label}>Activity</Text>
            {info.activity.map((a, i) => (
              <Line key={i} left={a.note || KIND[a.kind]} sub={fmtWhen(a.at)} right={money(a.cents, { always: true })} color={a.cents > 0 ? p.ok : p.ink} />
            ))}
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: p.muted, textAlign: "center" }}>Your earnings show here when you finish jobs.</Text>
        )}
      </View>
    </Screen>
  );
}
