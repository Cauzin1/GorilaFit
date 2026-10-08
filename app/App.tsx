// Gorila app — fluxo: conectar → plano IA → apostar → treino (QR + desafio + saída) → liquidar.
// Rodar com dev client (MWA não funciona no Expo Go): `npx expo run:android`.
// Identidade: índigo/roxo escuro + dourado, tom coach/RPG. Tokens em src/theme.ts.
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFonts } from "expo-font";
import { PublicKey } from "@solana/web3.js";
import {
  Camera,
  Coins,
  Dumbbell,
  ExternalLink,
  QrCode,
  Sparkles,
  Trophy,
} from "lucide-react-native";
import { connectWallet, explorerTx } from "./src/wallet";
import { QR_RENEW_SECS, useUserQr } from "./src/userQr";
import { createCommitment, settleCommitment } from "./src/commitmentTx";
import { readCommitmentState, type CommitmentState } from "./src/commitment";
import { colors, fonts, radius, space, touchMin } from "./src/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export default function App() {
  const [fontsLoaded] = useFonts({
    [fonts.display]: require("./assets/fonts/BarlowCondensed-Bold.ttf"),
    [fonts.body]: require("./assets/fonts/Barlow-Regular.ttf"),
    [fonts.bodyBold]: require("./assets/fonts/Barlow-SemiBold.ttf"),
  });
  const [reduceMotion, setReduceMotion] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [stake, setStake] = useState("");
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [betting, setBetting] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const [betTx, setBetTx] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleTx, setSettleTx] = useState<string | null>(null);
  const [settleBurst, setSettleBurst] = useState(0);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  async function onConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const key = await connectWallet();
      setAddress(key.toBase58());
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Falha ao conectar wallet.");
    } finally {
      setConnecting(false);
    }
  }

  async function onPlan() {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const res = await fetch(`${API_URL}/api/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "Recruta", history: "sem histórico" }),
      });
      const data = await res.json();
      if (data.ok) setPlan(data.plan);
      else setPlanError(data.error ?? "A IA não respondeu. Tente de novo.");
    } catch {
      setPlanError("Sem conexão com o servidor. Confira a internet e tente de novo.");
    } finally {
      setPlanLoading(false);
    }
  }

  function onStakeChange(v: string) {
    const clean = v.replace(/[^0-9.]/g, "");
    setStake(clean);
    const n = Number(clean);
    setStakeError(!clean ? null : Number.isFinite(n) && n > 0 ? null : "Digite um valor maior que zero.");
  }

  async function onBet() {
    setBetError(null);
    setBetTx(null);
    const amount = Number(stake);
    if (!address) {
      setBetError("Conecte a wallet primeiro.");
      return;
    }
    if (!plan) {
      setBetError("Gere o plano da IA primeiro (etapa 1).");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setBetError("Digite um stake válido em SKR.");
      return;
    }
    setBetting(true);
    try {
      const res = await createCommitment(
        new PublicKey(address),
        plan.targetWorkouts,
        amount,
        plan.durationUnits,
      );
      setCommitment(res.commitment);
      setBetTx(res.signature);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao apostar.";
      setBetError(/StaleTimestamp|0x1778|6008/.test(msg) ? "A transação demorou e expirou. Tente de novo." : msg);
    } finally {
      setBetting(false);
    }
  }

  async function onSettle() {
    setSettleError(null);
    setSettleTx(null);
    if (!address || !commitment) {
      setSettleError("Nada para liquidar: conecte e aposte primeiro.");
      return;
    }
    setSettling(true);
    try {
      const state = await readCommitmentState(commitment);
      const left = state.endTs - Math.floor(Date.now() / 1000);
      if (state.status !== "Active") {
        setSettleError("Este compromisso já foi liquidado.");
        return;
      }
      if (left > 0) {
        setSettleError(`Ainda faltam ${formatDuration(left)}. Volte após o fim do compromisso.`);
        return;
      }
      const sig = await settleCommitment(new PublicKey(address), new PublicKey(commitment));
      setSettleTx(sig);
      const after = await readCommitmentState(commitment).catch(() => null);
      if (after?.status === "Won") setSettleBurst((b) => b + 1);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : "Falha ao liquidar.");
    } finally {
      setSettling(false);
    }
  }

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel="Marca Gorila: halter dourado"
          style={styles.brand}
        >
          <Dumbbell color={colors.onGold} size={40} strokeWidth={2.5} />
        </View>
        <Text style={styles.title}>GORILA</Text>
        <Text style={styles.subtitle}>Proof of Sweat — Recruta</Text>

        {!address ? (
          <View>
            <GoldButton
              label={connecting ? "Conectando…" : "Conectar wallet (Seeker)"}
              onPress={onConnect}
              loading={connecting}
              accessibilityHint="Abre a wallet do Seeker para autorizar o app"
            />
            {connectError && <ErrorText message={connectError} />}
          </View>
        ) : (
          <Text style={styles.text}>Wallet: {address.slice(0, 8)}…</Text>
        )}

        <Section title="1. Plano da IA" icon={<Sparkles color={colors.gold} size={22} />}>
          <GoldButton label={planLoading ? "Consultando a IA…" : "Gerar meu plano"} onPress={onPlan} loading={planLoading} />
          {planError && <ErrorText message={planError} />}
          {plan && (
            <Text style={styles.text}>
              {plan.targetWorkouts} treinos em {plan.durationUnits} dias. {plan.suggestion}
            </Text>
          )}
        </Section>

        <Section title="2. Apostar SKR" icon={<Coins color={colors.gold} size={22} />}>
          <Text nativeID="stakeLabel" style={styles.label}>
            Valor do stake (em SKR)
          </Text>
          <TextInput
            value={stake}
            onChangeText={onStakeChange}
            keyboardType="decimal-pad"
            accessibilityLabelledBy="stakeLabel"
            accessibilityLabel="Valor do stake em SKR"
            accessibilityHint="Quanto você trava no compromisso. Volta com bônus se cumprir a meta."
            style={[styles.input, stakeError ? styles.inputError : null]}
          />
          <Text style={styles.helper}>Em SKR. Cumpriu a meta: volta com +10% de bônus. Desistiu: financia o pool.</Text>
          {stakeError && <ErrorText message={stakeError} />}
          <View style={{ marginTop: space.sm }}>
            <GoldButton
              label={betting ? "Apostando…" : `Apostar ${stake || "0"} SKR`}
              onPress={onBet}
              loading={betting}
              accessibilityHint="Trava o stake no cofre on-chain e cria o compromisso"
            />
          </View>
          {betError && <ErrorText message={betError} />}
          {betTx && <ExplorerLink signature={betTx} label="Aposta confirmada. Ver no explorer" />}
          <Text nativeID="commitmentLabel" style={[styles.label, { marginTop: space.md }]}>
            Commitment (após apostar, ou cole da devnet)
          </Text>
          <CommitmentField onCommitment={setCommitment} />
          <Text style={styles.text}>Ativo: {commitment ?? "nenhum ainda"}</Text>
        </Section>

        <Section title="3. Treino — mostre este QR ao tablet" icon={<QrCode color={colors.gold} size={22} />}>
          <WorkoutQr commitment={commitment} />
        </Section>

        <Section title="4. Desafio por foto" icon={<Camera color={colors.gold} size={22} />}>
          <Desafio commitment={commitment} reduceMotion={reduceMotion} />
        </Section>

        <Section title="5. Liquidar" icon={<Trophy color={colors.gold} size={22} />}>
          <Text style={styles.helper}>Disponível após o fim do compromisso. Cumpriu: stake + bônus. Senão: vai pro pool.</Text>
          <View style={{ marginTop: space.sm }}>
            <GoldButton
              label={settling ? "Liquidando…" : "Liquidar compromisso"}
              onPress={onSettle}
              loading={settling}
              accessibilityHint="Encerra o compromisso e recebe stake mais bônus se cumpriu a meta"
            />
          </View>
          {settleError && <ErrorText message={settleError} />}
          {settleTx && <ExplorerLink signature={settleTx} label="Liquidação confirmada. Ver no explorer" />}
          {settleBurst > 0 && <FitcoinBurst key={`settle-${settleBurst}`} reduceMotion={reduceMotion} />}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- Componentes ----------

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.h2}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function GoldButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const off = loading || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy: loading }}
      android_ripple={{ color: "#00000033" }}
      style={({ pressed }) => [styles.button, pressed && !off && styles.buttonPressed, off && styles.buttonOff]}
    >
      {loading ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      {message}
    </Text>
  );
}

function ExplorerLink({ signature, label }: { signature: string; label: string }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(explorerTx(signature))}
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${explorerTx(signature)}`}
      style={styles.link}
    >
      <Text style={styles.linkText}>{label} </Text>
      <ExternalLink color={colors.gold} size={18} />
    </Pressable>
  );
}

function CommitmentField({ onCommitment }: { onCommitment: (c: string | null) => void }) {
  const [value, setValue] = useState("");
  return (
    <View style={styles.row}>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Endereço do commitment"
        accessibilityHint="Cole o endereço da conta do compromisso criado na devnet"
        placeholder="Endereço do Commitment"
        placeholderTextColor={colors.textDim}
        style={[styles.input, styles.rowInput]}
      />
      <Pressable
        onPress={() => onCommitment(value.trim() || null)}
        disabled={value.trim() === ""}
        accessibilityRole="button"
        accessibilityLabel="Usar este commitment"
        android_ripple={{ color: "#00000033" }}
        style={({ pressed }) => [
          styles.button,
          styles.rowButton,
          (pressed || value.trim() === "") && styles.buttonOff,
        ]}
      >
        <Text style={styles.buttonText}>Usar</Text>
      </Pressable>
    </View>
  );
}

function WorkoutQr({ commitment }: { commitment: string | null }) {
  const { qr, secondsLeft } = useUserQr(commitment);
  const [state, setState] = useState<CommitmentState | null>(null);

  useEffect(() => {
    if (!commitment) {
      setState(null);
      return;
    }
    let alive = true;
    const load = () => {
      void readCommitmentState(commitment)
        .then((s) => alive && setState(s))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [commitment]);

  if (!qr) return <Text style={styles.text}>Aposte para gerar seu QR.</Text>;
  const remaining = state ? Math.max(0, state.endTs - Math.floor(Date.now() / 1000)) : null;
  const pct = state && state.target > 0 ? Math.min(1, state.completed / state.target) : 0;
  return (
    <View>
      <View accessible accessibilityRole="image" accessibilityLabel={`QR do treino. Renova em ${secondsLeft} segundos.`}>
        <QRCode value={JSON.stringify(qr)} size={220} backgroundColor="#ffffff" />
      </View>
      <Text style={styles.helper} accessibilityLiveRegion="polite">
        QR renova em {secondsLeft}s de {QR_RENEW_SECS}s. Entrada e saída no mesmo tablet.
      </Text>
      {state && (
        <View style={{ marginTop: space.md }}>
          <Text style={styles.text}>
            Progresso: {state.completed}/{state.target} treinos
            {state.sessionOpen ? " · sessão aberta" : ""}
            {state.status !== "Active" ? ` · ${state.status === "Won" ? "vencido" : "perdido"}` : ""}
          </Text>
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ now: state.completed, min: 0, max: state.target }}>
            <View style={[styles.fill, { flex: pct, backgroundColor: colors.gold }]} />
            <View style={{ flex: 1 - pct }} />
          </View>
          {remaining !== null && <Text style={styles.helper}>Termina em {formatDuration(remaining)}.</Text>}
        </View>
      )}
    </View>
  );
}

function Desafio({ commitment, reduceMotion }: { commitment: string | null; reduceMotion: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [challenge, setChallenge] = useState<any>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const cameraRef = useRef<CameraView>(null);

  if (!commitment) return <Text style={styles.text}>Aposte primeiro.</Text>;
  if (!permission) return <ActivityIndicator color={colors.gold} />;
  if (!permission.granted) {
    return permission.canAskAgain ? (
      <GoldButton label="Liberar câmera" onPress={() => void requestPermission()} accessibilityHint="Pede acesso à câmera para o desafio por foto" />
    ) : (
      <View>
        <Text style={styles.text}>Câmera bloqueada. Libere nos ajustes do aparelho.</Text>
        <GoldButton label="Abrir ajustes" onPress={() => void Linking.openSettings()} />
      </View>
    );
  }

  async function onDraw() {
    setDrawing(true);
    setDrawError(null);
    try {
      const res = await fetch(`${API_URL}/api/challenge/new`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commitment }),
      });
      const data = await res.json();
      if (data.ok) setChallenge(data);
      else setDrawError(data.error ?? "Não foi possível sortear. Tente de novo.");
    } catch {
      setDrawError("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setDrawing(false);
    }
  }

  async function onCapture() {
    if (!challenge || !cameraRef.current) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.6 });
      const res = await fetch(`${API_URL}/api/challenge/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.challengeId, commitment, imageBase64: photo?.base64 ?? "" }),
      });
      const data = await res.json();
      if (data.ok && data.passed) {
        setBurst((b) => b + 1); // animação "+X FitCoin"
        setChallenge(null);
      } else {
        setSubmitError(data.reason ?? data.error ?? "Não aprovado. Tente de novo antes do prazo.");
      }
    } catch {
      setSubmitError("Falha ao enviar a foto. Tente de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View>
      <GoldButton label={drawing ? "Sorteando…" : "Sortear desafio"} onPress={onDraw} loading={drawing} />
      {drawError && <ErrorText message={drawError} />}
      {challenge && (
        <View style={{ marginTop: space.md }}>
          <Text style={styles.text}>Instrução: {challenge.instruction}</Text>
          <CameraView ref={cameraRef} style={styles.camera} facing="front">
            <Text style={styles.cameraNote}>Só câmera do app — sem galeria. Foto descartada após julgamento.</Text>
          </CameraView>
          <View style={{ marginTop: space.sm }}>
            <GoldButton
              label={submitting ? "Enviando…" : "Capturar e enviar"}
              onPress={onCapture}
              loading={submitting}
              accessibilityHint="Tira a foto do desafio e envia para a IA julgar"
            />
          </View>
          {submitError && <ErrorText message={submitError} />}
        </View>
      )}
      {burst > 0 && <FitcoinBurst key={burst} reduceMotion={reduceMotion} />}
    </View>
  );
}

// Animação celebratória curta de "+X FitCoin". Pula tudo com reduced-motion.
function FitcoinBurst({ reduceMotion }: { reduceMotion: boolean }) {
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.4)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.2, friction: 4, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 600, delay: 400, useNativeDriver: true }),
      ]),
    ]).start();
  }, [scale, opacity, reduceMotion]);
  return (
    <Animated.View style={[styles.burst, { transform: [{ scale }], opacity }]} accessibilityRole="alert">
      <Coins color={colors.gold} size={32} />
      <Text style={styles.burstText}>+1 FITCOIN</Text>
    </Animated.View>
  );
}

function formatDuration(totalSecs: number) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m <= 0) return `${s}s`;
  if (m < 60) return `${m}min ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

// ---------- Estilos (só tokens de theme.ts) ----------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: space.lg, paddingBottom: space.xl },
  brand: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  title: { color: colors.gold, fontSize: 40, fontWeight: "900", fontFamily: fonts.display, letterSpacing: 2 },
  subtitle: { color: colors.text, fontSize: 16, marginBottom: space.md, fontFamily: fonts.body },
  section: { marginTop: space.lg },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: space.sm },
  h2: { color: colors.gold, fontSize: 20, fontWeight: "700", fontFamily: fonts.display, marginLeft: space.sm },
  text: { color: colors.text, fontSize: 16, lineHeight: 24, fontFamily: fonts.body },
  label: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: space.sm, fontFamily: fonts.bodyBold },
  helper: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginTop: space.sm, fontFamily: fonts.body },
  error: { color: colors.error, fontSize: 15, fontWeight: "600", marginTop: space.sm, fontFamily: fonts.bodyBold },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    minHeight: touchMin,
    paddingHorizontal: space.md,
    fontSize: 16,
    borderRadius: radius,
    fontFamily: fonts.body,
  },
  inputError: { borderColor: colors.error, borderWidth: 2 },
  button: {
    backgroundColor: colors.gold,
    minHeight: touchMin,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  buttonPressed: { opacity: 0.85 },
  buttonOff: { opacity: 0.45 },
  buttonText: { color: colors.onGold, fontSize: 17, fontWeight: "800", fontFamily: fonts.bodyBold },
  row: { flexDirection: "row", alignItems: "center" },
  rowInput: { flex: 1, marginRight: space.sm },
  rowButton: { minHeight: touchMin, paddingHorizontal: space.md },
  track: { flexDirection: "row", height: 12, borderRadius: 6, backgroundColor: colors.surface, marginTop: space.sm, overflow: "hidden" },
  fill: { borderRadius: 6 },
  camera: { height: 300, marginTop: space.md, borderRadius: radius, overflow: "hidden", justifyContent: "flex-end" },
  cameraNote: { color: "#ffffff", backgroundColor: "#000000aa", padding: space.sm, fontSize: 13, fontFamily: fonts.body },
  burst: { alignItems: "center", marginTop: space.md, padding: space.md, borderRadius: radius, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.gold },
  burstText: { color: colors.gold, fontSize: 28, fontWeight: "900", fontFamily: fonts.display, letterSpacing: 1 },
  link: { marginTop: space.sm, minHeight: touchMin, flexDirection: "row", alignItems: "center" },
  linkText: { color: colors.gold, fontSize: 16, fontWeight: "700", textDecorationLine: "underline", fontFamily: fonts.bodyBold },
});
