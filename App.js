import "react-native-gesture-handler";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Linking, Easing, StatusBar, Share, Dimensions, Modal } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics"; // Snack поддерживает, можно отключить если нужно
import { KeyboardAvoidingView, Platform, ActivityIndicator, Switch, Pressable, PanResponder, Animated } from "react-native";
import { NavigationContainer, useFocusEffect } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { createStackNavigator } from "@react-navigation/stack";
import twrnc from "twrnc";
import { useWindowDimensions } from "react-native";
import { DraggableGrid } from "react-native-draggable-grid";
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as ImagePicker from "expo-image-picker";
import { Image } from "react-native";
import { FlatList } from "react-native";
import tw from "twrnc";


// ===== MyCar: service storage =====
const MYCAR_SERVICE_KEY = "mycar/service";

async function loadMyCarService(){
  try{
    const raw = await AsyncStorage.getItem(MYCAR_SERVICE_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(e){
    console.log("mycar service load", e);
    return {};
  }
}

async function saveMyCarService(svc){
  try{
    await AsyncStorage.setItem(MYCAR_SERVICE_KEY, JSON.stringify(svc));
  }catch(e){
    console.log("mycar service save", e);
  }
}
// ==================================

  // Категории
  const CATEGORIES = [
    { key:"fuel", label:"Топливо", subs:["Бензин","Дизель"] },
    { key:"wash", label:"Мойка" },
    { key:"tire", label:"Шиномонтаж" },
    { key:"service", label:"Ремонт/Сервис" },
    { key:"fluids", label:"ПЗМ" },
    { key:"other", label:"Прочие затраты" },
  ];


/**
 * DriveAssist v7.3 (Snack, согласовано с Ереке)
 * Новое:
 * - Модальное окно оферты/ответственности после лого (обязательное). Без согласия — блокируем "ответственные" действия.
 * - Главный экран 3×3: Навигатор с камерами, ПДД, Ситуация / SOS, AiJoldas, MyCar / News, FAQ, Поиск.
 * - Навигатор: быстрые кнопки Дом/Работа/Своя + быстрые POI (АЗС, Мойка, ПЗМ, Шиномонтаж, EV, ГАЗ, Автосервис, ТехОсмотр). Deeplink с авто-фолбэком провайдера (2ГИС/Яндекс/Google).
 * - Ежедневное приветствие (Имя, марка авто) — 1 раз в день.
 * - Пустые разделы оставлены с мини-описанием "что будет".
 */

// =================== D-1: Expenses Model & Storage ===================
/**
 * @typedef {Object} Expense
 * @property {string} id        // uuid
 * @property {number} ts        // timestamp ms
 * @property {'fuel'|'wash'|'repair'|'fluids'|'other'} category
 * @property {number} amount    // in KZT
 * @property {number=} odometer
 * @property {string=} note
 */

const EXPENSES_KEY = 'expenses/v1';

async function loadExpenses(){
  try{
    const raw = await AsyncStorage.getItem(EXPENSES_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    console.log('expenses load failed', e);
    return [];
  }
}

async function saveExpenses(list){
  try{
    await AsyncStorage.setItem(EXPENSES_KEY, JSON.stringify(list));
  }catch(e){
    console.log('expenses save failed', e);
  }
}

async function addExpense(expense){
  const list = await loadExpenses();
  list.push(expense);
  await saveExpenses(list);
  return list;
}

function startOfMonth(date = new Date()){
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function endOfMonth(date = new Date()){
  return new Date(date.getFullYear(), date.getMonth()+1, 0, 23, 59, 59, 999).getTime();
}

function calcMonthly(list, when = new Date()){
  const from = startOfMonth(when);
  const to   = endOfMonth(when);
  const month = list.filter(x => x.ts >= from && x.ts <= to);
  const total = month.reduce((s,x)=>s + (Number(x.amount)||0), 0);
  const byCat = month.reduce((acc,x)=>{
    acc[x.category] = (acc[x.category]||0) + (Number(x.amount)||0);
    return acc;
  }, {});
  return { total, byCat, count: month.length };
}
// =====================================================================


// ----------------- THEME (C-5) -----------------
const ThemeContext = React.createContext(null);

const PALETTE = {
  dark: {
    bg:        "#0b0b0f",
    card:      "#0f172a",
    cardSoft:  "#111827",
    text:      "#f1f5f9",
    subtext:   "#94a3b8",
    border:    "#334155",
    accent:    "#22d3ee",
    accentText:"#000000",
    muted:     "#6b7280",
  },
  light: {
    bg:        "#f6f7fb",
    card:      "#ffffff",
    cardSoft:  "#f1f5f9",
    text:      "#0f172a",
    subtext:   "#475569",
    border:    "#cbd5e1",
    accent:    "#06b6d4",
    accentText:"#000000",
    muted:     "#94a3b8",
  },
};

function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("ThemeContext missing");
  return ctx;
}

function ThemeProvider({ children }) {
  const [theme, setTheme] = React.useState("dark");
  const colors = PALETTE[theme];

  React.useEffect(() => {
    (async () => {
      try {
  const saved = await AsyncStorage.getItem("app_theme");
  if (saved === "dark" || saved === "light") setTheme(saved);
} catch (e) {
  console.log("Theme load error:", e);
}

    })();
  }, []);

  const toggle = React.useCallback(async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { 
  await AsyncStorage.setItem("app_theme", next); 
} catch (e) {
  console.log("Theme save error:", e);
}

  }, [theme]);

  const value = React.useMemo(() => ({ theme, colors, toggle }), [theme, colors, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Кнопка-переключатель темы (иконка в шапке)
const ThemeToggleButton = () => {
  const { theme, toggle, colors } = useTheme();
  return (
    <TouchableOpacity onPress={toggle} style={[tw`px-3 py-2 rounded-xl`, { backgroundColor: colors.cardSoft }]}>
      <Text style={{ color: colors.text, fontWeight: "bold" }}>{theme === "dark" ? "☀" : "🌙"}</Text>
    </TouchableOpacity>
  );
};

// Sprint C-4: мини-бот Ai Joldas (локальная логика без сети)
function aiRespond(userText) {
  const t = (userText || "").toLowerCase();

  // простые намерения
  if (t.includes("азс") || t.includes("заправ")) {
    return "Понял задачу с АЗС. Открой «Навигатор» → «АЗС», я уже подготовил быстрые кнопки по пути.";
  }
  if (t.includes("шин") || t.includes("колесо")) {
    return "Если спустило колесо: «Ситуация» → «Спустило колесо». Там чек-лист и кнопка поиска шиномонтажа рядом.";
  }
  if (t.includes("пдд") || t.includes("штраф") || /\bст\.?\s?\d+/.test(t)) {
    return "По ПДД KZ у нас будет раздел с популярными статьями и наказаниями. Пока задай конкретный вопрос — отвечу кратко и по делу.";
  }
  if (t.includes("маршрут") || t.includes("дом") || t.includes("работ")) {
    return "Маршрут: в «Навигаторе» сохрани Дом/Работу и включи авто-обновление — каждые 5 мин маршрут актуализируется.";
  }

  // общий ответ по умолчанию (MVP)
  return "Принял. Зафиксирую и вернусь с улучшением. Можешь уточнить задачу одной-двумя фразами?";
}

// Sprint C: уведомления (утро/вечер)
async function ensureNotifPermission() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  }
  return true;
}
async function scheduleDailyLocal(hour, minute, title, body) {
  const ok = await ensureNotifPermission();
  if (!ok) { Alert.alert("Уведомления", "Нет разрешения на отправку уведомлений"); return null; }
  // Ежедневный триггер по локальному времени
  return await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { hour, minute, repeats: true },
  });
}
async function cancelAllNotifs() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

function toRad(x){return (x*Math.PI)/180;}
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371; // km
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c; // km
}
// Sprint C — тексты для полуденных подсказок
function middayBody(kind) {
  switch (kind) {
    case "news": return "Свежая авто-подборка дня готова. Открыть раздел News?";
    case "laws": return "Обновления по ПДД и популярные вопросы. Открыть раздел ПДД?";
    case "humor": return "Немного улыбки в середине дня 🙂 Открыть подборку?";
    default: return "Полезная подсказка дня.";
  }
}

async function pushHistory(event){
  try{
    const raw = await AsyncStorage.getItem("history");
    const arr = raw ? JSON.parse(raw) : [];
    arr.push({ ts: Date.now(), ...event });

    // Храним только последние 500 событий, без порчи JSON
    const MAX_EVENTS = 500;
    if (arr.length > MAX_EVENTS) {
      arr.splice(0, arr.length - MAX_EVENTS);
    }

    await AsyncStorage.setItem("history", JSON.stringify(arr));
  }catch(e){ console.log("history error", e); }
}


function sendEvent(name, props={}){
  const payload = { name, ...props };
  console.log("[event]", payload);
  pushHistory(payload);
}
const MAP_PROVIDERS = ["2gis", "yandex", "google"];
// Хэлпер deeplink навигатора (упрощённо)
function openMap(query, preferred = "auto") {
  const enc = encodeURIComponent(query);
  // Строим кандидатов ссылок
  const urlsBy = {
    "2gis":  `dgis://2gis.ru/search/${enc}`,
    "yandex":`yandexmaps://search?text=${enc}`,
    "google":`geo:0,0?q=${enc}`, // универсальная для Google/системной
  };

  // Если выбран конкретный провайдер — пробуем его первым
  const order = preferred !== "auto"
    ? [preferred, ...MAP_PROVIDERS.filter(p => p !== preferred)]
    : MAP_PROVIDERS.slice();

  (async () => {
    for (const p of order) {
      const url = urlsBy[p];
      const ok = await Linking.canOpenURL(url);
      if (ok) { Linking.openURL(url); return; }
    }
    Alert.alert("Навигатор", "Не найден установленный навигатор. Установите 2ГИС/Яндекс/Google Maps.");
  })();
}

// Общие компоненты
const Btn = ({ title, onPress, variant = "primary", disabled = false }) => {
  const { colors } = useTheme();
  const scale = React.useRef(new Animated.Value(1)).current;

  const onPressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  const box =
    variant === "ghost"
      ? { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.95 }
      : { backgroundColor: colors.accent };

  const titleStyle =
    variant === "ghost"
      ? { color: colors.text, fontWeight: "700" }
      : { color: colors.accentText, fontWeight: "800" };

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: disabled ? 0.6 : 1 }}>
      <Pressable
        disabled={disabled}
        onPress={async () => { try { await Haptics.selectionAsync(); } catch (e) {console.log("Handled error:", e);} onPress && onPress(); }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        android_ripple={{ color: colors.accent + "33" }}
        style={[tw`px-4 py-3 rounded-xl items-center justify-center`, box]}
      >
        <Text style={titleStyle}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
};



const Tile = ({
  emoji,
  title,
  onPress,
  size = 110,
  variant = "primary",
  disabled = false,
  editMode = false,
}) => {
  const { colors } = useTheme();
  const scale = React.useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  };

  const handlePress = async () => {
    if (editMode || disabled) return;
    try { await Haptics.selectionAsync(); } catch (e) {console.log("Handled error:", e);}
    onPress && onPress();
  };

  const baseBox = {
    width: size,
    height: size,
    borderRadius: 16,
    padding: 16,
    justifyContent: "center",
    alignItems: "center",
  };

  // variant: "ghost" = тонкая рамка, иначе плотный карточный фон
  const boxStyle =
    variant === "ghost"
      ? { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.95 }
      : { backgroundColor: colors.cardSoft, opacity: 0.9  };

  const opacity = disabled ? 0.55 : 0.9;
  const titleStyle = { color: disabled ? colors.subtext : colors.text, fontWeight: "700", fontSize: 13 };

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <Pressable
        onPress={handlePress}
        disabled={editMode || disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        android_ripple={{ color: colors.accent + "33", borderless: false }}
        style={[baseBox, boxStyle, tw`shadow`]}
      >
        <Text style={tw`text-4xl mb-2`}>{emoji}</Text>
        <Text numberOfLines={1} style={titleStyle}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
};




const Card = ({ title, children, right }) => {
  const { colors } = useTheme(); // <- берём цвета из палитры
  return (
    <View style={[
  tw`rounded-2xl p-4 my-2`,
  { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, opacity: 0.95 }
]}>
      <View style={tw`flex-row items-center justify-between mb-2`}>
        <Text style={[tw`font-extrabold text-base` , { color: colors.text }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
};


const Row = ({ label, value }) => {
  const { colors } = useTheme();
  return (
    <View style={tw`flex-row justify-between my-1`}>
      <Text style={{ color: colors.subtext }}>{label}</Text>
      <Text style={[tw`font-semibold` , { color: colors.text }]}>{value}</Text>
    </View>
  );
};


// ----------------- ГЛОБАЛЬНЫЕ МОДАЛКИ -----------------
function ConsentModal({ visible, onAccept, onDecline }){
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={tw`flex-1 bg-black/70 items-center justify-center p-6`}>
        <View style={tw`bg-[#0f172a] rounded-2xl p-5 w-full`}>
          <Text style={tw`text-[#f1f5f9] text-lg font-extrabold mb-2`}>Пользовательское соглашение</Text>
          <ScrollView style={tw`max-h-72`}>
            <Text style={tw`text-slate-300`}>
              Используя приложение, вы подтверждаете, что действуете на свой риск и несёте личную ответственность за принятые решения и действия. 
              Разделы с навигацией, предупреждениями о камерах, SOS и оповещениями предоставляются как справочная информация и не заменяют соблюдение ПДД. 
              Отправка координат и уведомлений доверенным контактам выполняется только с вашего согласия. 
              Продолжая, вы принимаете оферту и условия ответственности.
            </Text>
          </ScrollView>
          <View style={tw`mt-4`}>
  <Btn title="Принимаю" onPress={onAccept} /> 
  <Btn title="Отклоняю" onPress={onDecline} />
</View>
        </View>
      </View>
    </Modal>
  );
}

function GreetingModal({ visible, onSave, onCancel, initName="", initCar="" }){
  const [name, setName] = useState(initName);
  const [car, setCar] = useState(initCar);
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={tw`flex-1 bg-black/60 items-center justify-center p-6`}>
        <View style={tw`bg-[#0f172a] rounded-2xl p-5 w-full`}>
          <Text style={tw`text-[#f1f5f9] text-lg font-extrabold mb-2`}>Познакомимся?</Text>
          <Text style={tw`text-[#94a3b8] mb-3`}>Укажи имя и марку авто — подстроим подсказки и уведомления.</Text>
          <Text style={tw`text-slate-300 mb-1`}>Имя</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Ереке" placeholderTextColor="#6b7280" style={tw`text-[#f1f5f9] bg-[#111827] p-3 rounded-xl mb-3`} />
          <Text style={tw`text-slate-300 mb-1`}>Марка авто</Text>
          <TextInput value={car} onChangeText={setCar} placeholder="Toyota / Kia / ..." placeholderTextColor="#6b7280" style={tw`text-[#f1f5f9] bg-[#111827] p-3 rounded-xl mb-4`} />
          <Btn title="Сохранить" onPress={()=>onSave({ name: name.trim(), car: car.trim() })} />
          <Btn title="Позже" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}
// Sprint C: уведомления — глобальный хендлер
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ----------------- ЭКРАНЫ -----------------
function SplashScreen({ navigation }){
  const {theme, colors } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    const t = setTimeout(()=> navigation.replace("Home"), 1200);
    return () => { loop.stop(); clearTimeout(t); };
  }, [navigation, spin]);
  const rotate = spin.interpolate({ inputRange:[0,1], outputRange:["0deg","360deg"] });
  return (
    <View style={[tw`flex-1 items-center justify-center`, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <Animated.View style={{ transform:[{ rotate }] }}>
        <Text style={tw`text-5xl`}>🚗</Text>
      </Animated.View>
      <Text style={tw`text-[#f1f5f9] mt-4 text-xl font-extrabold`}>DriveAssist</Text>
      <Text style={tw`text-[#94a3b8] mt-1`}>Помощник водителя</Text>
    </View>
  );
}

function HomeScreen({ navigation }) {
  const fade = React.useRef(new Animated.Value(0)).current;
React.useEffect(() => {
  Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
}, [fade]);
  // --- служебные состояния (как у тебя уже есть) ---
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [greetNeeded, setGreetNeeded] = useState(false);
  const [profile, setProfile] = useState({ name: "", car: "" });
  const [consentAccepted, setConsentAccepted] = useState(false);
  const {theme, colors } = useTheme();
  const [ideaText, setIdeaText] = React.useState("");

const IDEA_KEY = "home/ideaPos";
const IDEA_VIS_KEY = "home/ideaVisible";

const CHECK_KEY = "home/checklist/v1";
const REMIND_KEY = "home/checklist/nextRemind";

const [checkOpen, setCheckOpen] = React.useState(false);
const [checklist, setChecklist] = React.useState({
  contacts: false,   // доверенные контакты
  offer: false,      // оферта/ответственность
  techpass: false,   // техпаспорт (фото/внесён)
  geo: false,        // согласие на геопозицию
});
const [nextRemindAt, setNextRemindAt] = React.useState(null);

// загрузка
React.useEffect(()=>{
  (async ()=>{
    try{
      const raw = await AsyncStorage.getItem(CHECK_KEY);
      if(raw){ setChecklist(JSON.parse(raw)); }
    }catch(e){ console.log('checklist load', e); }
    try{
      const rawR = await AsyncStorage.getItem(REMIND_KEY);
      if(rawR){ setNextRemindAt(Number(rawR)); }
    }catch(e){/* noop */ void 0;}
  })();
},[]);

// если что-то не выполнено и нет отложенного напоминания — открываем
React.useEffect(()=>{
  const allDone = Object.values(checklist).every(Boolean);
  if (allDone) { setCheckOpen(false); return; }

  // проверка отложенного напоминания
  const now = Date.now();
  if (nextRemindAt && now < nextRemindAt) return;

  setCheckOpen(true);
}, [checklist, nextRemindAt]);

const saveChecklist = async (obj) => {
  setChecklist(obj);
  try{ await AsyncStorage.setItem(CHECK_KEY, JSON.stringify(obj)); }catch(e){/* noop */ void 0;}
};

const snooze = async (minutes=180) => {
  const ts = Date.now() + minutes*60*1000;
  setNextRemindAt(ts);
  try{ await AsyncStorage.setItem(REMIND_KEY, String(ts)); }catch(e){/* noop */ void 0;}
  setCheckOpen(false);
};


// начальная позиция по умолчанию
const ideaDefault = { x: 20, y: Dimensions.get('window').height - 220 };

// видимость карточки (чтобы можно было скрыть)
const [ideaVisible, setIdeaVisible] = React.useState(true);

// позиция (Animated.ValueXY)
const ideaPos = React.useRef(new Animated.ValueXY(ideaDefault)).current;

// загрузка сохранённой позиции/видимости
React.useEffect(()=>{
  (async ()=>{
    try{
      const raw = await AsyncStorage.getItem(IDEA_KEY);
      if(raw){
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          ideaPos.setValue({ x: p.x, y: p.y });
        }
      }
    }catch(e){ console.log('home idea load pos', e); }
    try{
      const rawVis = await AsyncStorage.getItem(IDEA_VIS_KEY);
      if(rawVis != null){
        setIdeaVisible(rawVis === '1');
      }
    }catch(e){ console.log('home idea load vis', e); }
  })();
}, [ideaPos]);

// сохранение позиции (на отпускании)
const saveIdeaPos = async (x, y) => {
  try{ await AsyncStorage.setItem(IDEA_KEY, JSON.stringify({ x, y })); }
  catch(e){ console.log('home idea save pos', e); }
};

// обработчики жестов
const ideaPan = React.useRef(
  PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      ideaPos.setOffset({ x: ideaPos.x.__getValue(), y: ideaPos.y.__getValue() });
      ideaPos.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event([null, { dx: ideaPos.x, dy: ideaPos.y }], { useNativeDriver: false }),
    onPanResponderRelease: () => {
      ideaPos.flattenOffset();

      // клампим в пределах экрана
      const W = Dimensions.get('window').width;
      const H = Dimensions.get('window').height;
      const cardW = 260;       // ширина карточки
      const margin = 10;       // отступы
      const gx = Math.max(margin, Math.min(ideaPos.x.__getValue(), W - cardW - margin));
      const gy = Math.max(margin, Math.min(ideaPos.y.__getValue(), H - 100)); // 100 — нижняя «мертвая зона» под системные элементы

      ideaPos.setValue({ x: gx, y: gy });
      saveIdeaPos(gx, gy);
    },
  })
).current;

  
const [svcAlert, setSvcAlert] = React.useState(null);
useFocusEffect(
  React.useCallback(() => {
    let alive = true;
    (async () => {
      try{
        const raw = await AsyncStorage.getItem("mycar/service");
        if (!alive) return;
        if (!raw) { setSvcAlert(null); return; }
        const s = JSON.parse(raw);
        if (s?.remind === false) { setSvcAlert(null); return; }

        const parseYMD = (x)=>{ const d=new Date(x); return isNaN(d.getTime())?null:d; };
        const days = (d)=>{ if(!d) return null; const now=new Date(); now.setHours(0,0,0,0); const end=new Date(d.getFullYear(),d.getMonth(),d.getDate()); return Math.round((end-now)/(24*60*60*1000)); };

        const items = [
          { k:'nextTO',      label:'ТО',        d: parseYMD(s.nextTO) },
          { k:'insuranceTo', label:'Страховка', d: parseYMD(s.insuranceTo) },
          { k:'inspectionTo',label:'Техосмотр', d: parseYMD(s.inspectionTo) },
        ].map(x => ({ ...x, days: days(x.d) }));

        const remindDays = Number.isFinite(Number(s.remindDays)) ? Number(s.remindDays) : 7;
        const bad = items
          .filter(x => x.days != null && x.days <= remindDays)
          .sort((a,b)=> (a.days ?? -999) - (b.days ?? -999));
        if (bad.length === 0) { setSvcAlert(null); return; }

        const top = bad[0];
        let text = `${top.label}: `;
        if (top.days == null) text += 'дата не указана';
        else if (top.days < 0) text += `просрочено на ${Math.abs(top.days)} дн`;
        else text += `через ${top.days} дн`;

        setSvcAlert(text);
      }catch(e){
        setSvcAlert(null);
      }
    })();
    return () => { alive = false; };
  }, [])
);

  // === GRID LAYOUT (HomeScreen) ===
const { width } = useWindowDimensions();   // ширина экрана (адаптируется)
const COLS = 3;          // кол-во колонок
const GAP = 16;          // зазор между плитками
const PADDING_H = 20;    // боковые отступы контейнера
// корректная формула без "слипания" по горизонтали:
const tileSize = Math.floor((width - PADDING_H * 2 - GAP * (COLS - 1)) / COLS);



  useEffect(() => {
    (async () => {
      sendEvent("app_open");
      const consent = await AsyncStorage.getItem("consentAccepted");
      const accepted = consent === "1";
      setConsentAccepted(accepted);
      setConsentNeeded(!accepted);

      const last = await AsyncStorage.getItem("greetLast");
      const today = new Date().toISOString().slice(0, 10);
      const profRaw = await AsyncStorage.getItem("userProfile");
      const prof = profRaw ? JSON.parse(profRaw) : { name: "", car: "" };
      setProfile(prof);
      if (last !== today) setGreetNeeded(true);
    })();
  }, []);

  async function acceptConsent() {
    await AsyncStorage.setItem("consentAccepted", "1");
    setConsentAccepted(true);
    setConsentNeeded(false);
  }
  async function declineConsent() {
    await AsyncStorage.setItem("consentAccepted", "0");
    setConsentAccepted(false);
    setConsentNeeded(false);
    Alert.alert("Внимание", "Без принятия условий некоторые функции будут недоступны.");
  }
  async function saveGreeting({ name, car }) {
    const today = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem("userProfile", JSON.stringify({ name, car }));
    await AsyncStorage.setItem("greetLast", today);
    setProfile({ name, car });
    setGreetNeeded(false);
  }

  const DEFAULT_TILES = React.useMemo(() => ([
  { id:"nav",   key:"nav",   emoji:"🧭", title:"Навигатор", route:"Navigator", lock:true },
  { id:"laws",  key:"laws",  emoji:"📘", title:"ПДД",       route:"Laws" },
  { id:"situ",  key:"situ",  emoji:"🆘", title:"Ситуация",  route:"Situation" },
  { id:"sos",   key:"sos",   emoji:"🚨", title:"SOS",       route:"SOS",      lock:true },
  { id:"ai",    key:"ai",    emoji:"🤖", title:"AiJoldas",  route:"AiJoldas" },
  { id:"car",   key:"car",   emoji:"🚗✦", title:"MyCar",    route:"MyCar" },
  { id:"news",  key:"news",  emoji:"📰", title:"News",      route:"News" },
  { id:"faq",   key:"faq",   emoji:"💬", title:"FAQ",       route:"FAQ" },
  { id:"srch",  key:"srch",  emoji:"🔎", title:"Поиск",     route:"Search" },
]), []);


  const [tiles, setTiles] = useState(DEFAULT_TILES);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("homeOrder"); // ["nav","laws",...]
      if (saved) {
        const order = JSON.parse(saved);
        const map = Object.fromEntries(DEFAULT_TILES.map(t => [t.key, t]));
        const restored = order.map(k => map[k]).filter(Boolean);
        const rest = DEFAULT_TILES.filter(t => !order.includes(t.key));
        setTiles([...restored, ...rest]);
      }
    })();
  }, [DEFAULT_TILES]);

  async function persistOrder(data) {
    await AsyncStorage.setItem("homeOrder", JSON.stringify(data.map(t => t.key)));
  }


  // --- UI ---
  return (
    <Animated.View style={[tw`flex-1`, { backgroundColor: colors.bg, opacity: fade }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />


      <View style={tw`flex-1 p-4 pt-6`}>
        {/* Шапка */}
        <View style={tw`mb-3 flex-row items-center justify-between`}>
          <View style={tw`flex-row items-center`}>
            <Text style={tw`text-3xl mr-2`}>🚗</Text>
            <View>
              <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800" }}>DriveAssist</Text>
              <Text style={{ color: colors.subtext }}>
                {profile.name ? `Привет, ${profile.name}!` : "Быстрее и безопаснее в дороге"}
              </Text>
            </View>
          </View>
            <View style={tw`flex-row items-center`}>
    <ThemeToggleButton />
    <View style={tw`w-2`} />
    <TouchableOpacity
      onPress={() => setEditMode(v => !v)}
      style={[tw`px-3 py-2 rounded-xl`, { backgroundColor: editMode ? "#fde68a" : colors.card, borderWidth:1, borderColor: colors.border }]}
    >
      <Text style={{ color: editMode ? "#111827" : colors.text, fontWeight: "800" }}>
        {editMode ? "Готово" : "Править"}
      </Text>
    </TouchableOpacity>
  </View>

                  </View>
{svcAlert && (
  <View style={{
    backgroundColor:'#fde68a', borderColor:'#f59e0b', borderWidth:1,
    padding:10, borderRadius:12, marginBottom:12
  }}>
    <Text style={{ color:'#111827', fontWeight:'800' }}>Сервис</Text>
    <Text style={{ color:'#1f2937', marginTop:4 }}>{svcAlert}</Text>
  </View>
)}

       {/* Адаптивная перетаскиваемая сетка без прыжков */}
<DraggableGrid
  data={tiles}
  extraData={colors}
  numColumns={COLS}
  itemHeight={tileSize}
  itemWidth={tileSize}
  isDragFreely={editMode}                 // перетаскивание работает только в режиме "Править"
  dragStartAnimationScale={1.02}
  contentContainerStyle={{
    paddingHorizontal: PADDING_H - GAP / 2,
    paddingTop: 8,
    paddingBottom: 24,
  }}
  // Тап по элементу (навигация). Работает, когда не редактируем
  onItemPress={(item) => {
    if (editMode) return;
    if (item.lock && !consentAccepted) {
      Alert.alert("Внимание", "Примите условия, чтобы использовать раздел");
      return;
    }
    if (Haptics && typeof Haptics.selectionAsync === "function") {
  Haptics.selectionAsync().catch((e) => console.warn("Haptics selection error:", e));
}
    navigation.navigate(item.route);
  }}
  // Сохранение нового порядка
  onDragRelease={(items) => {
  setTiles(items);
  persistOrder(items);
}}

  // Как рисуем каждую плитку
  renderItem={(item) => (
    <View
      style={{
        width: tileSize,
        height: tileSize,
        margin: GAP / 2
      }}
    >
      <Tile
        size={tileSize}
        emoji={item.emoji}
        title={item.title}
        editMode={editMode}
        // дубль навигации на случай, если библиотека не прокинет onItemPress
        onPress={() => {
          if (editMode) return;
          if (item.lock && !consentAccepted) {
            Alert.alert("Внимание", "Примите условия, чтобы использовать раздел");
            return;
          }
          if (Haptics && typeof Haptics.selectionAsync === "function") {
  Haptics.selectionAsync().catch((e) => console.warn("Haptics selection error:", e));
}
          navigation.navigate(item.route);
        }}
      />
    </View>
  )}
/>
      </View>
{/* Карточка "Идея" (перетаскиваемая, с сохранением позиции) */}
{ideaVisible && (
  <Animated.View
    {...ideaPan.panHandlers}
    style={[
      { position: 'absolute', zIndex: 50 },
      { transform: ideaPos.getTranslateTransform() },
    ]}
    pointerEvents="box-none"
  >
    <View
      style={{
        width: 260,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 10,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
      }}
    >
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
          💡 Ваша идея
        </Text>
        <TouchableOpacity
          onPress={async ()=>{
            setIdeaVisible(false);
            try{ await AsyncStorage.setItem(IDEA_VIS_KEY, '0'); }catch(e){/* noop */ void 0;}
          }}
          hitSlop={{ top:8, right:8, bottom:8, left:8 }}
        >
          <Text style={{ color: colors.subtext, fontSize: 16 }}>✕</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        placeholder="Коротко…"
        placeholderTextColor={colors.subtext}
        value={ideaText}
        onChangeText={setIdeaText}
        multiline
        style={{
          color: colors.text,
          backgroundColor: colors.cardSoft,
          borderRadius: 8,
          padding: 8,
          minHeight: 40,
          fontSize: 12,
          textAlignVertical: 'top',
        }}
      />

      <TouchableOpacity
        onPress={async () => {
          const t = (ideaText || '').trim();
          if (!t) { Alert.alert('Идея', 'Пусто'); return; }
          try {
            const raw = await AsyncStorage.getItem('ideas');
            const arr = raw ? JSON.parse(raw) : [];
            arr.push({ ts: Date.now(), text: t });
            await AsyncStorage.setItem('ideas', JSON.stringify(arr));
            setIdeaText('');
            sendEvent?.('idea', { idea: t });
            Alert.alert('Спасибо!', 'Идея сохранена');
          } catch (e) { Alert.alert('Ошибка', 'Не удалось сохранить'); }
        }}
        style={{
          marginTop: 6,
          alignSelf: 'flex-end',
          paddingVertical: 4,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: colors.primary || '#0ea5e9',
        }}
      >
        <Text style={{ color: '#000', fontWeight: '800', fontSize: 12 }}>Отправить</Text>
      </TouchableOpacity>
    </View>
  </Animated.View>
)}

{/* Кнопка вернуть карточку, если скрыли (правый нижний угол) */}
{!ideaVisible && (
  <View style={{ position:'absolute', right: 20, bottom: 30, zIndex: 40 }}>
    <TouchableOpacity
      onPress={async ()=>{
        setIdeaVisible(true);
        try{ await AsyncStorage.setItem(IDEA_VIS_KEY, '1'); }catch(e){/* noop */ void 0;}
      }}
      style={{
        paddingVertical:8, paddingHorizontal:12, borderRadius:14,
        backgroundColor: colors.card, borderWidth:1, borderColor: colors.border
      }}
    >
      <Text style={{ color: colors.text, fontWeight:'700' }}>💡 Идея</Text>
    </TouchableOpacity>
  </View>
)}
<Modal visible={checkOpen} transparent animationType="fade" onRequestClose={()=>snooze(180)}>
  <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', padding:16 }}>
    <View style={{ backgroundColor: colors.bg, borderRadius:16, padding:14, maxWidth:520, alignSelf:'center', width:'100%' }}>
      <Text style={{ color: colors.text, fontSize:18, fontWeight:'800', marginBottom:8 }}>
        Обязательные шаги для безопасности
      </Text>
      <Text style={{ color: colors.subtext, marginBottom:12 }}>
        Это займёт пару минут. После выполнения окно больше не покажется.
      </Text>

      {[
        { key:'contacts', label:'Добавить доверенные контакты', why:'Чтобы в экстренной ситуации быстро связаться с близкими' },
        { key:'offer',    label:'Принять оферту и ответственность', why:'Это юридически защищает и вас, и нас' },
        { key:'techpass', label:'Сфотографировать и внести техпаспорт', why:'Чтобы иметь быстрый доступ к VIN/модели/данным авто' },
        { key:'geo',      label:'Дать согласие на геопозицию', why:'Для подсказок, навигации, сервисов рядом и SOS' },
      ].map(item=>{
        const on = !!checklist[item.key];
        return (
          <View key={item.key} style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:1, borderBottomColor: colors.border }}>
            <View style={{ flex:1, paddingRight:10 }}>
              <Text style={{ color: colors.text, fontWeight:'700' }}>{item.label}</Text>
              {!on && (
                <TouchableOpacity onPress={()=>Alert.alert(item.label, item.why)} hitSlop={{top:8,right:8,bottom:8,left:8}}>
                  <Text style={{ color: colors.subtext, textDecorationLine:'underline', marginTop:2 }}>Зачем это нужно?</Text>
                </TouchableOpacity>
              )}
            </View>

            {on ? (
              <View style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:10, backgroundColor:'#16a34a' }}>
                <Text style={{ color:'#fff', fontWeight:'700' }}>Готово</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={()=>{
                  const next = { ...checklist, [item.key]: true };
                  saveChecklist(next);
                }}
                style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:10, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
              >
                <Text style={{ color: colors.text, fontWeight:'700' }}>Отметить</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:12 }}>
        <TouchableOpacity
          onPress={()=>snooze(180)} // напомнить через 3 часа
          style={{ paddingVertical:10, paddingHorizontal:14, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
        >
          <Text style={{ color: colors.text, fontWeight:'700' }}>Напомнить позже</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={()=>{
            const allTrue = { contacts:true, offer:true, techpass:true, geo:true };
            saveChecklist(allTrue);
            setCheckOpen(false);
          }}
          style={{ paddingVertical:10, paddingHorizontal:14, borderRadius:12, backgroundColor: colors.primary||'#0ea5e9' }}
        >
          <Text style={{ color:'#000', fontWeight:'800' }}>Отметить всё как выполнено</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>


      {/* модалки как были */}
      <ConsentModal visible={consentNeeded} onAccept={acceptConsent} onDecline={declineConsent} />
      <GreetingModal
        visible={greetNeeded}
        onSave={saveGreeting}
        onCancel={() => setGreetNeeded(false)}
        initName={profile.name}
        initCar={profile.car}
      />
    </Animated.View>
  );
}


// --- Навигатор ---
function NavigatorScreen() {
  const { colors } = useTheme();

  // ---- состояние
  const [home, setHome] = useState("");
  const [work, setWork] = useState("");
  const [fav,  setFav]  = useState("");

  const [provider, setProvider] = useState("auto"); // "auto" | "2gis" | "yandex" | "google"
  const [refreshMin, setRefreshMin] = useState(5);  // период авто-обновления
  const [activeQuery, setActiveQuery] = useState(null); // текущий маршрут
  const timerRef = useRef(null);

useEffect(() => {
  if (!activeQuery) return;
  const id = setInterval(() => openMap(activeQuery), 5 * 60 * 1000);
  return () => clearInterval(id);
}, [activeQuery]);

  // ---- загрузка сохранённых настроек/адресов
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem("navAddresses");
        if (saved) {
          const { home:h, work:w, fav:f } = JSON.parse(saved);
          setHome(h || ""); setWork(w || ""); setFav(f || "");
        }
        const pref = await AsyncStorage.getItem("navProvider");
        if (pref) setProvider(pref);
        const per = await AsyncStorage.getItem("navRefreshMin");
        if (per && Number(per) > 0) setRefreshMin(Number(per));
      } catch(e) { console.log("nav load", e); }
    })();
  }, []);

  // ---- авто-обновление маршрута
  useEffect(() => {
    if (!activeQuery) return;        // не запущено
    // очистить предыдущий таймер
    if (timerRef.current) clearInterval(timerRef.current);

    // запустить новый
    timerRef.current = setInterval(() => {
      openMap(activeQuery, provider);
      sendEvent("nav_autorefresh", { q: activeQuery, min: refreshMin, provider });
    }, refreshMin * 60 * 1000);

    return () => {                   // очистка при уходе со страницы/смене параметров
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeQuery, refreshMin, provider]);

  // ---- действия
  async function saveAddresses() {
    await AsyncStorage.setItem("navAddresses", JSON.stringify({ home, work, fav }));
    Alert.alert("Сохранено", "Быстрые адреса обновлены");
  }
  async function saveProvider(p) {
    setProvider(p);
    await AsyncStorage.setItem("navProvider", p);
  }
  async function saveRefresh(m) {
    setRefreshMin(m);
    await AsyncStorage.setItem("navRefreshMin", String(m));
  }
  function startRoute(q) {
    const query = (q || "").trim() || "дом"; // запасной
    setActiveQuery(query);                   // включает авто-обновление
    openMap(query, provider);
    sendEvent("nav_route_start", { q: query, provider });
  }
  function stopAuto() {
    setActiveQuery(null);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    Alert.alert("Маршрут", "Авто-обновление остановлено");
  }

  // ---- UI
  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>

      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>Навигатор</Text>

      {/* Быстрые адреса */}
      <Card title="Быстрые адреса">
        <TextInput
          placeholder="Дом (улица, дом)"
          placeholderTextColor="#6b7280"
          value={home}
          onChangeText={setHome}
          style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl mb-2`}
        />
        <TextInput
          placeholder="Работа (улица, дом)"
          placeholderTextColor="#6b7280"
          value={work}
          onChangeText={setWork}
          style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl mb-2`}
        />
        <TextInput
          placeholder="Избранное (название + адрес)"
          placeholderTextColor="#6b7280"
          value={fav}
          onChangeText={setFav}
          style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl mb-2`}
        />
        <Btn title="Сохранить адреса" onPress={saveAddresses} />
        <View style={tw`flex-row flex-wrap -mx-1 mt-1`}>
          <Btn title="Домой"      onPress={() => { const q = (home || "дом").trim(); setActiveQuery(q); openMap(q); }} />
<Btn title="На работу"  onPress={() => { const q = (work || "работа").trim(); setActiveQuery(q); openMap(q); }} />
<Btn title="Избранное"  onPress={() => { const q = (fav  || "избранное").trim(); setActiveQuery(q); openMap(q); }} />

        </View>
             </Card>

      {/* Провайдер и авто-обновление */}
      <Card title="Настройки маршрута">
        <Text style={tw`text-[#94a3b8] mb-2`}>Провайдер навигации</Text>
        <View style={tw`flex-row flex-wrap -mx-1 mb-2`}>
          {[
            {k:"auto",   t:"Авто"},
            {k:"2gis",   t:"2ГИС"},
            {k:"yandex", t:"Яндекс"},
            {k:"google", t:"Google"},
          ].map(opt => (
            <View key={opt.k} style={tw`px-1 mb-1`}>
              <Btn
                title={`${opt.t}${provider===opt.k ? " ✓" : ""}`}
                variant={provider===opt.k ? "primary" : "ghost"}
                onPress={()=>saveProvider(opt.k)}
              />
            </View>
          ))}
        </View>

        <Text style={tw`text-[#94a3b8] mb-2`}>Авто-обновление маршрута</Text>
        <View style={tw`flex-row -mx-1 mb-2`}>
          {[5,10,15,30].map(m => (
            <View key={m} style={tw`px-1`}>
              <Btn
                title={`${m} мин${refreshMin===m ? " ✓" : ""}`}
                variant={refreshMin===m ? "primary" : "ghost"}
                onPress={()=>saveRefresh(m)}
              />
            </View>
          ))}
        </View>

        {activeQuery ? (
          <>
            <Text style={tw`text-slate-300 mb-1`}>Активный маршрут: {activeQuery}</Text>
            <Btn title="Остановить авто-обновление" variant="ghost" onPress={stopAuto} />
          </>
        ) : (
          <Text style={tw`text-[#64748b]`}>Авто-обновление выключено</Text>
        )}
      </Card>

      {/* По пути (быстрые POI) */}
      {/* По пути (быстрые POI) */}
<View style={tw`flex-row flex-wrap justify-between`}>
  {["АЗС","Мойка","ПЗМ","Шиномонтаж","EV зарядки","ГАЗ","Автосервис","ТехОсмотр"].map((label) => (
    <TouchableOpacity
      key={label}
      style={[
        tw`w-[48%] rounded-2xl py-4 px-3 mb-3`,
        { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
      ]}
      onPress={() => openMap(label, provider)}
      activeOpacity={0.8}
    >
      <Text style={[tw`text-center font-bold`, { color: colors.text }]}>{label}</Text>
    </TouchableOpacity>
  ))}
</View>


      <Card title="Статус маршрута">
  {activeQuery ? (
    <>
      <Text style={tw`text-slate-300 mb-2`}>Активный маршрут: {activeQuery}</Text>
      <Btn title="Остановить авто-обновление" variant="ghost" onPress={() => setActiveQuery(null)} />
      <Btn title="Обновить сейчас" onPress={() => openMap(activeQuery)} />
    </>
  ) : (
    <Text style={tw`text-[#64748b]`}>Маршрут не запущен</Text>
  )}
</Card>

    </ScrollView>
  );
}


// --- Ситуация ---
function SituationScreen() {
  const { colors } = useTheme();

  // выбранный сценарий и шаг
  const [scenario, setScenario] = useState(null); // ключ сценария
  const [step, setStep] = useState(0);

  const S = {
    'dtp_noinj': {
      title: 'ДТП без пострадавших',
      steps: [
        'Включите аварийку, выставьте знак.',
        'Зафиксируйте: фото/видео, общая сцена, номера, повреждения.',
        'Схема ДТП: положение авто, направления, знаки/разметка.',
        'Обмен данными: ВУ, СРТС, страховка, контакты.',
        'Оформление: европротокол/вызов патруля при споре.',
      ],
      actions: [
        { t:'Открыть камеру телефона', f:()=> Linking.openURL('camera:') },
        { t:'Позвонить в страховую', f:()=> Alert.alert('Страховая', 'Добавим быстрые номера страховок в MyCar') },
      ]
    },
    'dtp_inj': {
      title: 'ДТП с пострадавшими',
      steps: [
        'Оцените безопасность: остановите авто, аварийка, знак.',
        'Позвоните 112. Сообщите местоположение и характер травм.',
        'Первая помощь: дыхание/кровотечение/позиция, не перемещайте без угрозы.',
        'Не употребляйте алкоголь/лекарства, ждите службы.',
        'Фиксация места происшествия без вмешательства в обстановку.',
      ],
      actions: [
        { t:'Позвонить 112', f:()=> Linking.openURL('tel:112') },
        { t:'Отправить SOS доверенным', f:()=> Alert.alert('SOS', 'Откройте раздел SOS → «Отправить SMS доверенным»') },
      ]
    },
    'tyre': {
      title: 'Спустило колесо',
      steps: [
        'Прижмитесь к обочине/парковке, включите аварийку.',
        'Поставьте знак, наденьте жилет.',
        'Проверьте комплект: домкрат, балонник, запаска/ремкомплект.',
        'Замените колесо или используйте ремкомплект/компрессор.',
        'Доезжайте до шиномонтажа — проверьте остальные колёса.',
      ],
      actions: [
        { t:'Найти Шиномонтаж рядом', f:()=> openMap('Шиномонтаж') },
        { t:'Найти Компрессор/АЗС', f:()=> openMap('АЗС компрессор') },
      ]
    },
    'battery': {
      title: 'Сел АКБ',
      steps: [
        'Проверьте, горит ли приборка/свет — убедитесь, что дело в АКБ.',
        'Попросите «прикурить»: провода, не перепутайте полярность.',
        'Используйте бустер, если он есть.',
        'После запуска не глушите 15–20 минут, проверьте генератор.',
        'Если повторяется — езжайте в сервис диагностики.',
      ],
      actions: [
        { t:'Найти помощь пуском', f:()=> openMap('Пуск двигателя услуги') },
        { t:'Найти автосервис', f:()=> openMap('Автосервис') },
      ]
    },
    'no_start': {
      title: 'Не заводится авто',
      steps: [
        'Проверьте КПП (P/N), педаль тормоза, иммобилайзер/ключ.',
        'Слушайте: щелчки (стартер), тишина (АКБ), крутит без запуска (топливо/искра).',
        'Проверьте ошибки/лампы на панели.',
        'Исключите пустой бак/зимнюю солярку/предохранители.',
        'При необходимости вызывайте эвакуатор/диагностику.',
      ],
      actions: [
        { t:'Вызвать эвакуатор', f:()=> openMap('Эвакуатор') },
        { t:'Поиск автоэлектрика', f:()=> openMap('Автоэлектрик') },
      ]
    },
  };

  const LIST = [
    { key:'dtp_noinj', emoji:'📝', t:'ДТП без пострадавших' },
    { key:'dtp_inj',   emoji:'🚑', t:'ДТП с пострадавшими' },
    { key:'tyre',      emoji:'🛞', t:'Спустило колесо' },
    { key:'battery',   emoji:'🔋', t:'Сел АКБ' },
    { key:'no_start',  emoji:'🛠️', t:'Не заводится авто' },
  ];

  const current = scenario ? S[scenario] : null;

  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>

      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>Ситуация</Text>

      {!current && (
        <Card title="Выберите ситуацию">
          {LIST.map(it => (
            <TouchableOpacity key={it.key} onPress={()=>{ setScenario(it.key); setStep(0); }}>
              <View style={tw`py-3 border-b border-[#1f2937]  flex-row items-center`}>
                <Text style={tw`text-xl mr-2`}>{it.emoji}</Text>
                <Text style={tw`text-[#f1f5f9] font-semibold`}>{it.t}</Text>
              </View>
            </TouchableOpacity>
          ))}
          <Text style={tw`text-[#94a3b8] mt-2`}>Пошаговые чек-листы доступны офлайн.</Text>
        </Card>
      )}

      {current && (
        <>
          <Card title={current.title}>
            <Text style={tw`text-[#94a3b8] mb-2`}>Шаг {step+1} из {current.steps.length}</Text>
            <Text style={tw`text-[#f1f5f9] mb-3`}>{current.steps[step]}</Text>

            <View style={tw`flex-row justify-between`}>
              <Btn title="Назад" variant="ghost" onPress={()=>{
                if (step>0) setStep(step-1); else setScenario(null);
              }} />
              {step < current.steps.length-1
                ? <Btn title="Далее" onPress={()=> setStep(step+1)} />
                : <Btn title="Завершить" onPress={()=> setScenario(null)} />
              }
            </View>
          </Card>

          <Card title="Быстрые действия">
  {current.actions.map((a, i)=> (
    <View key={i} style={tw`mb-2`}>
      <Btn title={a.t} onPress={a.f} />
    </View>
  ))}
</Card>

        </>
      )}
    </ScrollView>
  );
}


// --- SOS ---
function SOSScreen(){
  const { colors } = useTheme();
  const [contacts, setContacts] = useState(["+7XXXXXXXXXX", "+7YYYYYYYYYY"]);
  const [countdown, setCountdown] = useState(null); // 30..0
  // Храним ТОЛЬКО 10 цифр без префикса +7
const [newPhoneDigits, setNewPhoneDigits] = useState(""); // "7012345678"

// форматтер вида XXX XXX XXXX
function fmtKZ10(digits) {
  const d = (digits || "").replace(/\D/g, "").slice(0, 10);
  const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
  return [a, b, c].filter(Boolean).join(" ");
}


// загрузка сохранённых доверенных
useEffect(() => {
  (async () => {
    try {
      const raw = await AsyncStorage.getItem("trustedContacts");
      if (raw) setContacts(JSON.parse(raw));
    } catch (e) { console.log("load trustedContacts", e); }
  })();
}, []);

// сохранять при любом изменении
useEffect(() => {
  (async () => {
    try {
      await AsyncStorage.setItem("trustedContacts", JSON.stringify(contacts));
    } catch (e) { console.log("save trustedContacts", e); }
  })();
}, [contacts]);


  useEffect(()=>{ if(countdown===null) return; if(countdown===0){
      // здесь отправка уведомлений доверенным; в MVP покажем Alert
      Alert.alert("SOS", `Отправлено доверенным: ${contacts.join(', ')}`);
      sendEvent("sos_sent", { contacts }); setCountdown(null);
    } else {
      const t = setTimeout(()=> setCountdown(countdown-1), 1000);
      return ()=> clearTimeout(t);
    }
  }, [countdown, contacts]);
async function sendSOSMessage() {
  try {
    let coordsText = "координаты неизвестны";
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      coordsText = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
    }
    const body = `SOS! Нужна помощь. Меня указали как доверенный контакт.\nКоординаты: ${coordsText}`;
    const smsUri = `sms:${contacts.join(",")}${Platform.OS === "android" ? `?body=${encodeURIComponent(body)}` : ""}`;
    await Linking.openURL(smsUri);
    sendEvent("sos_sms", { contactsCount: contacts.length });
  } catch (e) {
    Alert.alert("SOS", "Не удалось открыть SMS на устройстве");
  }
}

  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>SOS</Text>
      <Card title="Экстренные">
  <View style={tw`flex-row flex-wrap -mx-1 mb-2`}>
    <View style={tw`w-1/2 px-1 mb-2`}>
      <Btn title="🚓 102 Полиция" variant="danger" onPress={() => { sendEvent("sos_police"); Linking.openURL("tel:102"); }} />
    </View>
    <View style={tw`w-1/2 px-1 mb-2`}>
      <Btn title="🚑 103 Скорая" variant="danger" onPress={() => { sendEvent("sos_ambulance"); Linking.openURL("tel:103"); }} />
    </View>
    <View style={tw`w-1/2 px-1 mb-2`}>
      <Btn title="🚒 101 Пожарные" variant="danger" onPress={() => { sendEvent("sos_fire"); Linking.openURL("tel:101"); }} />
    </View>
    <View style={tw`w-1/2 px-1 mb-2`}>
      <Btn title="🆘 112 Единый" variant="danger" onPress={() => { sendEvent("sos_112"); Linking.openURL("tel:112"); }} />
    </View>
  </View>

  <Btn title={countdown ? `Отмена (${countdown})` : "Запустить обратный отсчёт 30с"} onPress={() => setCountdown(countdown ? null : 30)} />
  <Btn title="Я в порядке" variant="ghost" onPress={() => { setCountdown(null); Alert.alert("OK", "Сигнал отменён"); }} />
</Card>

      <Card title="Доверенные контакты">
        <Text style={tw`text-[#94a3b8] mb-2`}>При подтверждении SOS отправим SMS с координатами.</Text>

{/* ввод нового номера */}
{/* поле ввода: фиксированный префикс +7 и 10 цифр справа */}
<View style={tw`flex-row items-center mb-2`}>
  <View style={tw`bg-[#111827] px-3 py-3 rounded-xl mr-2`}>
    <Text style={tw`text-[#f1f5f9] font-bold`}>+7</Text>
  </View>
  <TextInput
    placeholder="XXX XXX XXXX"
    placeholderTextColor="#6b7280"
    value={fmtKZ10(newPhoneDigits)}
    onChangeText={(t) => {
      // берём только цифры, максимум 10
      const digits = (t || "").replace(/\D/g, "").slice(0, 10);
      setNewPhoneDigits(digits);
    }}
    keyboardType="number-pad"
    maxLength={12} // "XXX XXX XXXX" = 12 символов
    style={tw`flex-1 text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl`}
  />
</View>
<Btn
  title="Добавить контакт"
  onPress={() => {
    if (newPhoneDigits.length !== 10) {
      Alert.alert("Контакт", "Введите 10 цифр после +7");
      return;
    }
    const normalized = `+7${newPhoneDigits}`;
    if (contacts.includes(normalized)) {
      Alert.alert("Контакты", "Этот номер уже в списке");
      return;
    }
    setContacts([...contacts, normalized]);
    setNewPhoneDigits("");
  }}
/>


{/* список доверенных */}
{contacts.length === 0 ? (
  <Text style={tw`text-[#64748b] mt-2`}>Пока пусто</Text>
) : (
  <FlatList
    data={contacts}
    keyExtractor={(x, i) => String(i)}
    renderItem={({ item, index }) => (
      <View style={tw`py-2 border-b border-[#1f2937]  flex-row justify-between items-center`}>
        <Text style={tw`text-[#f1f5f9]`}>{item}</Text>
        <TouchableOpacity onPress={() => setContacts(contacts.filter((_, i) => i !== index))}>
          <Text style={tw`text-red-400`}>Удалить</Text>
        </TouchableOpacity>
      </View>
    )}
  />
)}

{/* действия */}
<View style={tw`mb-2`}>
  <Btn title={countdown ? `Отмена (${countdown})` : "Запустить обратный отсчёт 30с"} onPress={() => setCountdown(countdown ? null : 30)} />
</View>
<View style={tw`mb-1`}>
  <Btn title="Отправить SMS доверенным" onPress={sendSOSMessage} />
</View>


      </Card>
      <Card title="Типовые ситуации">
        {['Спустило колесо','Сел АКБ','ДТП','Не заводится'].map((x)=> (
          <Btn key={x} title={x} variant="ghost" onPress={()=>Alert.alert(x, 'В разработке: выбор адресата и отправка координат')} />
        ))}
      </Card>
      <Text style={tw`text-[#64748b] mt-2`}>Важно: использование функции SOS подразумевает ваше согласие на отправку координат доверенным контактам.</Text>
    </ScrollView>
  );
}
// UI: подпись + тумблер
const ToggleRow = ({ label, value, onValueChange, hint }) => (
  <View style={tw`flex-row items-center justify-between mb-3`}>
    <View style={tw`flex-1 pr-4`}>
      <Text style={tw`text-[#f1f5f9] font-semibold`}>{label}</Text>
      {hint ? <Text style={tw`text-[#94a3b8] text-xs mt-0.5`}>{hint}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: "#334155", true: "#22d3ee" }}
      thumbColor={"#0b0b0f"}
    />
  </View>
);
// UI: компактный индикатор состояния (ВКЛ/ВЫКЛ)
const Chip = ({ on }) => (
  <View style={tw`${on ? "bg-cyan-400" : "bg-[#334155]"} px-2 py-1 rounded-full`}>
    <Text style={tw`${on ? "text-black" : "text-[#f1f5f9]"} text-xs font-bold`}>
      {on ? "ВКЛ" : "ВЫКЛ"}
    </Text>
  </View>
);
// UI: сегменты выбора (3 чипа)
const Segments = ({ value, onChange }) => {
  const Item = ({ k, label }) => (
    <TouchableOpacity
      onPress={() => onChange(k)}
      style={tw`${value === k ? "bg-cyan-400" : "bg-[#334155]"} px-3 py-1 rounded-full mr-2`}
    >
      <Text style={tw`${value === k ? "text-black" : "text-[#f1f5f9]"} text-xs font-bold`}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={tw`flex-row mt-2`}>
      <Item k="news" label="Новости" />
      <Item k="laws" label="ПДД" />
      <Item k="humor" label="Юмор" />
    </View>
  );
};

// --- AiJoldas ---
function AiJoldasScreen(){
  const fade = React.useRef(new Animated.Value(0)).current;
React.useEffect(() => {
  Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
}, [fade]);

    const { colors } = useTheme();
  const [voice, setVoice] = useState(true);
  const [morning, setMorning] = useState(true);
  const [evening, setEvening] = useState(true);
  // Sprint C-4: чат
const [msgInput, setMsgInput] = useState("");
const [sending, setSending] = useState(false);
// последние сообщения (храним до 50), формат: { id, from: "me"|"bot", text, ts }
const [messages, setMessages] = useState([]);
// Сводные статусы для чипов
const notifOn = morning || midday || evening || expensesReminder;

const voiceOn = voice;
// дневное уведомление (подборка)
const [midday, setMidday] = useState(true);
const [middayKind, setMiddayKind] = useState("news"); // 'news' | 'laws' | 'humor'
// напоминание о расходах в 22:00
const [expensesReminder, setExpensesReminder] = useState(true);

// мини-бухгалтерия за сегодня
const [expenseSum, setExpenseSum] = useState("");
const [expenseCat, setExpenseCat] = useState("Топливо");
const [expenseList, setExpenseList] = useState([]); // [{id, cat, sum, ts}]

// загрузить историю чата при входе
useEffect(() => {
  (async () => {
    try {
      const raw = await AsyncStorage.getItem("ai_messages");
      if (raw) setMessages(JSON.parse(raw));
      else {
        // приветственное
        const hello = [{ id: Date.now(), from: "bot", text: "Привет! Я Ai Joldas. Задавай что угодно по дороге, авто и ПДД — помогу быстро.", ts: Date.now() }];
        setMessages(hello);
        await AsyncStorage.setItem("ai_messages", JSON.stringify(hello));
      }
    } catch(e) { console.log("ai_messages load", e); }
  })();
}, []);

// сохранять историю при каждом изменении
useEffect(() => {
  (async () => {
    try {
      const keep = messages.slice(-50);
      await AsyncStorage.setItem("ai_messages", JSON.stringify(keep));
    } catch(e) { console.log("ai_messages save", e); }
  })();
}, [messages]);


  // Планирование/снятие уведомлений при переключении тумблеров
// Планирование/снятие уведомлений при переключении тумблеров (единый эффект)
// Планирование уведомлений (утро/полдень/вечер/22:00)
useEffect(() => {
  (async () => {
    await cancelAllNotifs();
    if (morning) await scheduleDailyLocal(8, 0, "Доброе утро!", "Построить оптимальный маршрут до работы?");
    if (midday) await scheduleDailyLocal(13, 0, "Подсказка дня", middayBody(middayKind));
    if (evening) await scheduleDailyLocal(18, 0, "Едем домой?", "Построить маршрут до дома?");
    if (expensesReminder) await scheduleDailyLocal(22, 0, "Как прошёл день?", "Зафиксируем расходы на авто за сегодня?");
  })();
}, [morning, midday, middayKind, evening, expensesReminder]);

async function handleSend() {
  const text = (msgInput || "").trim();
  if (!text) return;
  await Haptics.selectionAsync();

  const meMsg = { id: Date.now(), from: "me", text, ts: Date.now() };
  setMessages(prev => [...prev, meMsg]);
  setMsgInput("");
  setSending(true);

  // имитация «обдумывания» и ответ
  setTimeout(() => {
    try {
      const reply = aiRespond(text);
      const botMsg = { id: Date.now()+1, from: "bot", text: reply, ts: Date.now()+1 };
      setMessages(prev => [...prev, botMsg]);
    } finally {
      setSending(false);
    }
  }, 300);
}


  return (
    <Animated.ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>AiJoldas</Text>
      <Card title="Чат с Ai Joldas">
  <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80} style={tw`flex-1`}>
    {/* Лента сообщений */}
    <View style={tw`h-72 bg-[#0f172a] rounded-xl p-3 mb-2`}>
      <ScrollView ref={(ref) => { /* auto-scroll вниз */ if (ref) { /* keep ref */ } }}>
        {messages.map((m) => (
          <View key={m.id} style={[
            tw`mb-2 max-w-[85%] p-2 rounded-xl`,
            m.from === "me" ? tw`self-end bg-cyan-400` : tw`self-start bg-[#111827]`
          ]}>
            <Text style={m.from === "me" ? tw`text-black` : tw`text-[#f1f5f9]`}>{m.text}</Text>
          </View>
        ))}
        {sending && (
          <View style={tw`self-start flex-row items-center`}>
            <ActivityIndicator />
            <Text style={tw`ml-2 text-[#94a3b8]`}>Ai Joldas печатает…</Text>
          </View>
        )}
      </ScrollView>
    </View>

    {/* Поле ввода */}
    <View style={tw`flex-row items-center`}>
      <TextInput
        style={tw`flex-1 bg-[#111827] text-[#f1f5f9] p-3 rounded-xl mr-2`}
        placeholder="Спроси о дороге, ПДД, авто…"
        placeholderTextColor="#6b7280"
        value={msgInput}
        onChangeText={setMsgInput}
        onSubmitEditing={handleSend}
        returnKeyType="send"
      />
      <TouchableOpacity onPress={handleSend} disabled={sending} style={tw`${sending ? "bg-[#334155]" : "bg-cyan-400"} p-3 rounded-xl`}>
        <Text style={tw`text-black font-bold`}>Отпр</Text>
      </TouchableOpacity>
    </View>
  </KeyboardAvoidingView>
</Card>
      <Card
  title={
    <View style={[tw`flex-row items-center justify-between`, { paddingRight: 8 }]}>
      <Text style={tw`text-[#f1f5f9] text-base font-extrabold`}>Уведомления</Text>
      <Chip on={notifOn} />
    </View>
      }
>

  <ToggleRow
    label="Утром маршрут до работы"
    value={morning}
    onValueChange={setMorning}
    hint="В 08:00 напомнить построить маршрут до работы"
  />
  <ToggleRow
    label="Вечером маршрут домой"
    value={evening}
    onValueChange={setEvening}
    hint="В 18:00 напомнить построить маршрут до дома"
  />
</Card>
<Card
  title={
    <View style={[tw`flex-row items-center justify-between`, { paddingRight: 8 }]}>
      <Text style={tw`text-[#f1f5f9] text-base font-extrabold`}>Днём подсказки</Text>
      <Chip on={midday} />
    </View>
  }
>
  <ToggleRow
    label="Полуденное напоминание"
    value={midday}
    onValueChange={setMidday}
    hint="В 13:00: подборка новостей, ПДД или немного юмора"
  />
  <Text style={tw`text-[#94a3b8] mt-1`}>Что присылать:</Text>
  <Segments value={middayKind} onChange={setMiddayKind} />
</Card>

      <Card
  title={
    <View style={[tw`flex-row items-center justify-between`, { paddingRight: 8 }]}>
      <Text style={tw`text-[#f1f5f9] text-base font-extrabold`}>Голосовые подсказки</Text>
      <Chip on={voiceOn} />
    </View>
  }
>

  <ToggleRow
    label="Голос"
    value={voice}
    onValueChange={setVoice}
    hint="Включить/выключить голосовой ассистент"
  />
</Card>

      <Card title="База знаний">
        <Text style={tw`text-[#94a3b8]`}>В разработке: персональные подсказки по стилю вождения, предпочтениям маршрутов и авто.</Text>
      </Card>
      {/* Sprint C-4: Чат с Ai Joldas */}


    </Animated.ScrollView>
  );
}


// ===== MyCarScreen (пересборка) =====

function MyCarScreen({ navigation }) {
  const { colors } = useTheme();
  const [profile, setProfile] = React.useState({
    brand: "",
    model: "",
    year: "",
    plate: "",
    vin: "",
    mileage: "",
    techpassUri: "" 
  });
  const [editOpen, setEditOpen] = React.useState(false);
  const [brandPickerOpen, setBrandPickerOpen] = React.useState(false);
  const [vinError, setVinError] = React.useState(false);
  const [odoError, setOdoError] = React.useState(false);
const isVinLike = (s) => {
  if (!s) return false;
  const v = s.trim().toUpperCase();
  if (v.length < 11 || v.length > 20) return false;
  if (/[^A-HJ-NPR-Z0-9]/.test(v)) return false; // исключаем I,O,Q
  return true;
};
const PARTS_KEY = "mycar/parts/requests";

const [partsOpen, setPartsOpen] = React.useState(false);
const [parts, setParts] = React.useState([]); // список сохранённых запросов
const [partName, setPartName] = React.useState("");
const [partCategory, setPartCategory] = React.useState("");
const [partNote, setPartNote] = React.useState("");

const PART_CATEGORIES = React.useMemo(()=>[
  "Масла и жидкости","Фильтры","Тормозная система","Подвеска",
  "Двигатель","Трансмиссия","Электрика","Кузов","Шины и диски","Прочее"
],[]);

React.useEffect(()=>{
  (async ()=>{
    try{
      const raw = await AsyncStorage.getItem(PARTS_KEY);
      if(raw){ setParts(JSON.parse(raw)); }
    }catch(e){ /* noop */ void e; }
  })();
},[]);

const saveParts = async (next) => {
  setParts(next);
  try{ await AsyncStorage.setItem(PARTS_KEY, JSON.stringify(next)); }catch(e){ /* noop */ void e; }
};

const addPartRequest = async () => {
  const name = (partName||"").trim();
  const cat  = (partCategory||"").trim();
  const note = (partNote||"").trim();

  if(!name){
    Alert.alert("З/Ч","Укажи название запчасти (например, «масляный фильтр»).");
    return;
  }
  const item = {
    id: Date.now(),
    name,
    category: cat || "Прочее",
    note,
    vin: (profile.vin||"").trim().toUpperCase(),
    brand: (profile.brand||"").trim(),
    model: (profile.model||"").trim(),
    ts: new Date().toISOString()
  };
  const next = [item, ...(Array.isArray(parts)?parts:[])];
  await saveParts(next);

  setPartName(""); setPartCategory(""); setPartNote("");
  Alert.alert("З/Ч","Запрос сохранён. В следующем спринте — поиск по VIN и локации.");
};

const removePartRequest = async (id) => {
  const next = (parts||[]).filter(x=>x.id!==id);
  await saveParts(next);
};
// Простейшая карта WMI -> бренд (считаем первые 3 символа)
// Это не исчерпывающая база, но покрывает топовых производителей
const WMI_MAP = {
  "WVW": "Volkswagen", "WAU": "Audi", "WDB": "Mercedes-Benz", "WME": "Smart", "WBA": "BMW",
  "ZFA": "Fiat", "ZFF": "Ferrari", "ZAM": "Maserati", "ZHW": "Lamborghini",
  "VF1": "Renault", "VF3": "Peugeot", "VF7": "Citroën",
  "VSS": "SEAT", "VSK": "Nissan", "VSX": "Opel",
  "JHM": "Honda", "JHL": "Honda", "JTD": "Toyota", "JT3": "Toyota", "JTM": "Toyota", "JN1": "Nissan",
  "JM1": "Mazda", "JMB": "Mitsubishi", "JS2": "Suzuki", "JS1": "Suzuki", "JT2": "Toyota",
  "SAL": "Land Rover", "SAJ": "Jaguar",
  "1FA": "Ford", "1F2": "Ford", "1G1": "Chevrolet", "1G6": "Cadillac", "1HG": "Honda", "1C4": "Chrysler",
  "2HG": "Honda", "2G1": "Chevrolet",
  "3VW": "Volkswagen", "3FA": "Ford",
  "YV1": "Volvo", "YS3": "Saab",
  "KNM": "Kia", "KNA": "Kia", "KMH": "Hyundai",
  "LJC": "Chevrolet (SGM China)", "LVS": "MG", "LGB": "Dongfeng", "LSG": "SAIC General Motors",
  // добавляй нужные по ходу
};

const guessBrandByVIN = (vin) => {
  if (!isVinLike(vin)) return null;
  const v = vin.trim().toUpperCase();
  const wmi = v.slice(0,3);
  return WMI_MAP[wmi] || null;
};
  // --- сервис/напоминания ---
  const [svcOpen, setSvcOpen] = React.useState(false);
  const [svc, setSvc] = React.useState({
    nextTO: "",
    insuranceFrom: "",
    insuranceTerm: 12,
    insuranceTo: "",
    inspectionFrom: "",
    inspectionTerm: 12,
    inspectionTo: "",
    plan: [
      { key: "engine_oil",  title: "Мотор",                lastKm: "", intervalKm: 5000  },
      { key: "ps_fluid",    title: "ГУР",                  lastKm: "", intervalKm: 10000 },
      { key: "antifreeze",  title: "Антифриз",             lastKm: "", intervalKm: 20000 },
      { key: "gearbox",     title: "АКПП/МКПП",            lastKm: "", intervalKm: 40000 },
      { key: "axles",       title: "Мосты",                lastKm: "", intervalKm: 20000 },
      { key: "brake_fluid", title: "Тормозная жидкость",   lastKm: "", intervalKm: 20000 }
    ],
    custom: [],
    remind: true,
    remindDays: 7,
    remindKm: 1000,
    notes: ""
  });
const BRANDS = React.useMemo(()=>[
  "Toyota","Hyundai","Kia","Volkswagen","BMW","Mercedes-Benz","Audi","Nissan",
  "Honda","Mazda","Mitsubishi","Lexus","Chevrolet","Ford","Skoda","Renault",
  "Peugeot","Citroën","Volvo","Land Rover","Jaguar","Subaru","Suzuki","Opel"
],[]);

const filteredBrands = React.useMemo(() => {
  const q = (brandQuery ?? "").trim().toLowerCase();
  if (!q) return BRANDS;
  return BRANDS.filter(b => b.toLowerCase().includes(q));
}, [brandQuery, BRANDS]);  
const [brandQuery, setBrandQuery] = React.useState("");
const PINS_KEY = "mycar/pins";
const [pinsOpen, setPinsOpen] = React.useState(false);
const METRICS = React.useMemo(()=>[
  { key:'to',       label:'До ТО (дни)',                      type:'days' },
  { key:'ins',      label:'До страховки (дни)',               type:'days' },
  { key:'insp',     label:'До техосмотра (дни)',              type:'days' },
  { key:'engine_oil', label:'Мотор (км)',                     type:'km'   },
  { key:'ps_fluid',   label:'ГУР (км)',                       type:'km'   },
  { key:'antifreeze', label:'Антифриз (км)',                  type:'km'   },
  { key:'gearbox',    label:'АКПП/МКПП (км)',                 type:'km'   },
  { key:'axles',      label:'Мосты (км)',                     type:'km'   },
  { key:'brake_fluid',label:'Тормозная жидкость (км)',        type:'km'   },
  // свои ТО будут добавлены динамически снизу (key = 'custom:<id>')
], [/* static */]);
const [pins, setPins] = React.useState([]); // массив ключей метрик

React.useEffect(()=>{
  (async ()=>{
    try{
      const raw = await AsyncStorage.getItem(PINS_KEY);
      if(raw){ setPins(JSON.parse(raw)); }
    }catch(e){ console.log('mycar load pins', e); }
  })();
},[]);

const savePins = async (next) => {
  setPins(next);
  try{ await AsyncStorage.setItem(PINS_KEY, JSON.stringify(next)); }
  catch(e){ console.log('mycar save pins', e); }
};

const StatusBar = ({ label, valueText, ratio, color }) => (
  <View style={{ marginTop:6 }}>
    <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
      <Text style={{ color: colors.subtext }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight:'700' }}>{valueText}</Text>
    </View>
    <View style={{ height:8, backgroundColor: colors.cardSoft||'#0f172a', borderRadius:6, overflow:'hidden', marginTop:4 }}>
      <View style={{ width: `${Math.max(0, Math.min(100, Math.round(ratio*100)))}%`, height:'100%', backgroundColor: color }} />
    </View>
  </View>
);
  // --- storage keys ---
  const KEY_PROFILE = "mycar/profile";
  const KEY_SERVICE = "mycar/service";

  // --- helpers ---
  const _parseYMD = (s) => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const _daysDiff = (to) => {
    if (!to) return null;
    const now = new Date(); now.setHours(0,0,0,0);
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    const ms = end - now;
    return Math.round(ms / 86400000);
  };
  const _addMonths = (iso, months) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const n = new Date(d);
    n.setMonth(n.getMonth() + months);
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const day = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
const kmInfo = (item) => {
  const last = parseInt(item.lastKm||'0',10)||0;
  const interval = parseInt(item.intervalKm||'0',10)||0;
  if(!last || !interval) return { left:null, ratio:0, color:'#94a3b8', text:'—' };
  const current = parseInt(profile.mileage||'0',10)||0;
  const due = last + interval;
  const left = due - current;
  const lim = Number(svc.remindKm)||1000;
  let color = '#10b981';
  if (left < 0) color = '#ef4444';
  else if (left <= lim) color = '#f59e0b';
  // ratio: сколько уже пройдено в %, 0..1
  const done = Math.max(0, Math.min(1, (current - last)/Math.max(1, interval)));
  return { left, ratio: done, color, text: left<0 ? `просрочено ${Math.abs(left)} км` : `через ${left} км` };
};

const dayInfo = (toDate) => {
  const d = _parseYMD(toDate);
  if(!d) return { days:null, ratio:0, color:'#94a3b8', text:'—' };
  const days = _daysDiff(d);
  let color = '#10b981';
  if (days < 0) color = '#ef4444';
  else if (days <= (Number(svc.remindDays)||7)) color = '#f59e0b';
  // для ratio нужно "срок" — берем 365 условно
  const base = 365; // грубо для визуала
  const done = 1 - Math.max(0, Math.min(1, (days/base)));
  return { days, ratio: done, color, text: days<0 ? `просрочено ${Math.abs(days)} дн` : `через ${days} дн` };
};
  // --- загрузка ---
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rawP = await AsyncStorage.getItem(KEY_PROFILE);
        if (alive && rawP) {
          const p = JSON.parse(rawP);
          setProfile({
            brand:   p.brand   ?? "",
            model:   p.model   ?? "",
            year:    p.year    ?? "",
            plate:   p.plate   ?? "",
            vin:     p.vin     ?? "",
            mileage: p.mileage ?? "",
            techpassUri: p.techpassUri ?? ""
          });
        }
      } catch (e) { console.log("mycar load profile", e); }
      try {
        const rawS = await AsyncStorage.getItem(KEY_SERVICE);
        if (alive && rawS) {
          const s = JSON.parse(rawS);
          setSvc({
            nextTO: s.nextTO || "",
            insuranceFrom: s.insuranceFrom || "",
            insuranceTerm: Number.isFinite(+s.insuranceTerm) ? +s.insuranceTerm : 12,
            insuranceTo: s.insuranceTo || "",
            inspectionFrom: s.inspectionFrom || "",
            inspectionTerm: Number.isFinite(+s.inspectionTerm) ? +s.inspectionTerm : 12,
            inspectionTo: s.inspectionTo || "",
            plan: Array.isArray(s.plan) ? s.plan : [
              { key: "engine_oil",  title: "Мотор",                lastKm: "", intervalKm: 5000  },
              { key: "ps_fluid",    title: "ГУР",                  lastKm: "", intervalKm: 10000 },
              { key: "antifreeze",  title: "Антифриз",             lastKm: "", intervalKm: 20000 },
              { key: "gearbox",     title: "АКПП/МКПП",            lastKm: "", intervalKm: 40000 },
              { key: "axles",       title: "Мосты",                lastKm: "", intervalKm: 20000 },
              { key: "brake_fluid", title: "Тормозная жидкость",   lastKm: "", intervalKm: 20000 }
            ],
            custom: Array.isArray(s.custom) ? s.custom : [],
            remind: s.remind !== false,
            remindDays: typeof s.remindDays === "number" ? s.remindDays : 7,
            remindKm: Number.isFinite(+s.remindKm) ? +s.remindKm : 1000,
            notes: s.notes || ""
          });
        }
      } catch (e) { console.log("mycar load service", e); }
    })();
    return () => { alive = false; };
  }, []);

  // --- сохранение ---
  async function handleSaveProfile() {
    const vin = String(profile.vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const okLen = vin.length >= 9 && vin.length <= 20;
    if (!okLen) { setVinError(true); Alert.alert("Моё авто", "Проверь VIN (9–20 символов)"); return; }

    const km = String(profile.mileage || "").replace(/\D/g, "");
    if (!km) { setOdoError(true); Alert.alert("Моё авто", "Введите пробег (цифры)"); return; }

    const clean = {
      brand:  String(profile.brand||"").trim(),
      model:  String(profile.model||"").trim(),
      year:   String(profile.year||"").trim(),
      plate:  String(profile.plate||"").trim(),
      vin,
      mileage: km,
      techpassUri: profile.techpassUri || ""
    };
    setProfile(clean);
    try {
      await AsyncStorage.setItem(KEY_PROFILE, JSON.stringify(clean));
    } catch (e) {
      console.log('mycar save profile', e);
    }
    setEditOpen(false);
  }
async function handlePickTechpass() {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Фото", "Нет доступа к галерее. Разреши доступ в настройках.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true
    });
    if (res.canceled) return;
    const uri = res.assets?.[0]?.uri;
    if (!uri) return;
    setProfile(p => ({ ...p, techpassUri: uri }));
    // мгновенно сохраняем профиль с фото
    const clean = {
      brand:   String(profile.brand||"").trim(),
      model:   String(profile.model||"").trim(),
      year:    String(profile.year||"").trim(),
      plate:   String(profile.plate||"").trim(),
      vin:     String(profile.vin||"").trim().toUpperCase(),
      mileage: String(profile.mileage||"").trim(),
      techpassUri: uri
    };
    try { await AsyncStorage.setItem(KEY_PROFILE, JSON.stringify(clean)); } catch(e){/* noop */ void 0;}
  } catch (e) {
    console.log("pick techpass err", e);
    Alert.alert("Ошибка", "Не удалось выбрать фото.");
  }
}

function handleRemoveTechpass() {
  setProfile(p => ({ ...p, techpassUri: "" }));
}
  async function handleSaveSvc() {
    const clean = {
      nextTO: String(svc.nextTO||"").trim(),
      insuranceFrom: String(svc.insuranceFrom||"").trim(),
      insuranceTerm: Number.isFinite(+svc.insuranceTerm) ? +svc.insuranceTerm : 12,
      insuranceTo: String(svc.insuranceTo||"").trim(),
      inspectionFrom: String(svc.inspectionFrom||"").trim(),
      inspectionTerm: Number.isFinite(+svc.inspectionTerm) ? +svc.inspectionTerm : 12,
      inspectionTo: String(svc.inspectionTo||"").trim(),
      plan: Array.isArray(svc.plan) ? svc.plan : [],
      custom: Array.isArray(svc.custom) ? svc.custom : [],
      remind: !!svc.remind,
      remindDays: Number.isFinite(Number(svc.remindDays)) ? Number(svc.remindDays) : 7,
      remindKm: Number.isFinite(Number(svc.remindKm)) ? Number(svc.remindKm) : 1000,
      notes: String(svc.notes||"")
    };

    if (clean.insuranceFrom) clean.insuranceTo = _addMonths(clean.insuranceFrom, clean.insuranceTerm);
    if (clean.inspectionFrom) clean.inspectionTo = _addMonths(clean.inspectionFrom, clean.inspectionTerm);

    setSvc(clean);
    try {
      await AsyncStorage.setItem(KEY_SERVICE, JSON.stringify(clean));
    } catch (e) {
      console.log('mycar save service', e);
    }
    setSvcOpen(false);
  }

  // --- UI helpers ---
  const SummaryRow = ({ label, value }) => (
    <View style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:2 }}>
      <Text style={{ color: colors.subtext }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight:'700' }}>{value}</Text>
    </View>
  );

  const Pill = ({ text, color }) => (
    <Text style={{ color:'#0b0f17', backgroundColor:color, paddingHorizontal:8, paddingVertical:2, borderRadius:8, fontWeight:'700' }}>{text}</Text>
  );

  const kmBadge = (left) => {
    if (left == null) return <Pill text="—" color="#94a3b8" />;
    if (left < 0)     return <Pill text={`просрочено ${Math.abs(left)} км`} color="#ef4444" />;
    if (left <= (Number(svc.remindKm)||1000)) return <Pill text={`через ${left} км`} color="#f59e0b" />;
    return <Pill text={`через ${left} км`} color="#10b981" />;
  };

  // --- render ---
  return (
    <SafeAreaView style={{ flex:1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding:16, paddingBottom:96 }}>
        {/* Моё авто */}
        <View style={{ backgroundColor: colors.card, borderRadius:16, borderWidth:1, borderColor: colors.border, padding:14, marginBottom:12 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <Text style={{ color: colors.text, fontSize:16, fontWeight:'800' }}>Моё авто</Text>
            <TouchableOpacity
              onPress={()=>setEditOpen(true)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.text, fontWeight:'700' }}>Редактировать</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap:6 }}>
            <Text style={{ color: colors.subtext }}>
              {profile.brand || "—"} {profile.model || ""} {profile.year ? `(${profile.year})` : ""}
            </Text>
            <Text style={{ color: colors.subtext }}>Номер: {profile.plate || "—"}</Text>
            <Text style={{ color: colors.subtext }}>VIN: {profile.vin || "—"}</Text>
            <Text style={{ color: colors.subtext }}>Пробег: {profile.mileage || "—"} км</Text>
          </View>
        </View>

        {/* Сервис (сводка + CTA) */}
        <View style={{ backgroundColor: colors.card, borderRadius:16, borderWidth:1, borderColor: colors.border, padding:14, marginBottom:12 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            
<Text style={{ color: colors.text, fontWeight:'800', fontSize:16 }}>Сервисные данные</Text>


            <TouchableOpacity
              onPress={()=>setSvcOpen(true)}
              style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.text, fontWeight:'700' }}>Подробнее</Text>
            </TouchableOpacity>
            <TouchableOpacity
  onPress={()=>setPinsOpen(true)}
  style={{ marginLeft:8, paddingVertical:6, paddingHorizontal:12, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
>
  <Text style={{ color: colors.text, fontWeight:'700' }}>+ Добавить на главную</Text>
</TouchableOpacity>
          </View>
<TouchableOpacity
  onPress={()=>setPartsOpen(true)}
  style={{ marginLeft:8, paddingVertical:6, paddingHorizontal:12, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
>
  <Text style={{ color: colors.text, fontWeight:'700' }}>З/Ч</Text>
</TouchableOpacity>

          {/* Сводка дней */}
          {(() => {
            const to = _daysDiff(_parseYMD(svc.nextTO));
            const ins = _daysDiff(_parseYMD(svc.insuranceTo));
            const insp = _daysDiff(_parseYMD(svc.inspectionTo));
            return (
              <View style={{ marginBottom:8 }}>
                <SummaryRow label="До ТО" value={to==null ? "—" : (to<0 ? `просрочено ${Math.abs(to)} дн` : `${to} дн`)} />
                <SummaryRow label="До страховки" value={ins==null ? "—" : (ins<0 ? `просрочено ${Math.abs(ins)} дн` : `${ins} дн`)} />
                <SummaryRow label="До техосмотра" value={insp==null ? "—" : (insp<0 ? `просрочено ${Math.abs(insp)} дн` : `${insp} дн`)} />
              </View>
            );
          })()}
{pins.length>0 && (
  <View style={{ marginTop:10 }}>
    <Text style={{ color: colors.text, fontWeight:'800', marginBottom:4 }}>Моя сводка</Text>

    {/* дни */}
    {pins.includes('to')   && (()=>{ const i = dayInfo(svc.nextTO);      return <StatusBar label="До ТО"          valueText={i.text} ratio={i.ratio} color={i.color} /> })()}
    {pins.includes('ins')  && (()=>{ const i = dayInfo(svc.insuranceTo); return <StatusBar label="До страховки"   valueText={i.text} ratio={i.ratio} color={i.color} /> })()}
    {pins.includes('insp') && (()=>{ const i = dayInfo(svc.inspectionTo);return <StatusBar label="До техосмотра"  valueText={i.text} ratio={i.ratio} color={i.color} /> })()}

    {/* км по плану */}
    {(svc.plan||[]).map(it=>{
      if(!pins.includes(it.key)) return null;
      const i = kmInfo(it);
      return <StatusBar key={it.key} label={it.title} valueText={i.text} ratio={i.ratio} color={i.color} />;
    })}

    {/* свои ТО */}
    {(svc.custom||[]).map(c=>{
      const k = `custom:${c.id}`;
      if(!pins.includes(k)) return null;
      const i = kmInfo(c);
      return <StatusBar key={k} label={`Своя ТО: ${c.name||'Без названия'}`} valueText={i.text} ratio={i.ratio} color={i.color} />;
    })}
  </View>
)}
          {/* План ТО кратко */}
          <Text style={{ color: colors.text, fontWeight:'800' }}>План ТО (по пробегу)</Text>
          {(svc.plan||[]).map(item=>{
            const last = parseInt(item.lastKm||'0',10)||0;
            const interval = parseInt(item.intervalKm||'0',10)||0;
            const due = last && interval ? last + interval : null;
            const current = parseInt(profile.mileage||'0',10)||0;
            const left = (due!=null) ? (due - current) : null;
            return (
              <View key={item.key} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:4 }}>
                <Text style={{ color: colors.subtext }}>{item.title}</Text>
                {kmBadge(left)}
              </View>
            );
          })}

          {(svc.custom||[]).length>0 && (
            <>
              <View style={{ height:8 }} />
              <Text style={{ color: colors.text, fontWeight:'800' }}>Свои ТО</Text>
              {(svc.custom||[]).map(it=>{
                const last = parseInt(it.lastKm||'0',10)||0;
                const interval = parseInt(it.intervalKm||'0',10)||0;
                const due = last && interval ? last + interval : null;
                const current = parseInt(profile.mileage||'0',10)||0;
                const left = (due!=null) ? (due - current) : null;
                return (
                  <View key={it.id} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical:4 }}>
                    <Text style={{ color: colors.subtext }}>{it.name || "Без названия"}</Text>
                    {kmBadge(left)}
                  </View>
                );
              })}
            </>
          )}

          {/* CTA */}
          <View style={{ flexDirection:"row", flexWrap:"wrap", marginTop:8 }}>
            <View style={{ width:'50%', paddingRight:6, marginBottom:8 }}>
              <TouchableOpacity onPress={()=>setSvcOpen(true)} style={{ paddingVertical:10, borderRadius:12, alignItems:'center', backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight:'700' }}>Редактировать</Text>
              </TouchableOpacity>
            </View>
            <View style={{ width:'50%', paddingLeft:6, marginBottom:8 }}>
              <TouchableOpacity onPress={()=>navigation?.navigate?.('Expenses')} style={{ paddingVertical:10, borderRadius:12, alignItems:'center', backgroundColor: colors.primary||'#0ea5e9' }}>
                <Text style={{ color:'#000', fontWeight:'800' }}>Расходы</Text>
              </TouchableOpacity>
            </View>
            <View style={{ width:'50%', paddingRight:6 }}>
              <TouchableOpacity onPress={()=>Alert.alert('З/Ч','Поиск запчастей подключим на следующем шаге')} style={{ paddingVertical:10, borderRadius:12, alignItems:'center', backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight:'700' }}>З/Ч (поиск)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Модалка профиля */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={()=>setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{ flex:1 }}>
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' }}>
            <View style={{ backgroundColor: colors.bg, borderTopLeftRadius:18, borderTopRightRadius:18, maxHeight:'80%' }}>
              <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {/* Марка (пикер) */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>Марка</Text>
                  <TouchableOpacity
                    onPress={()=>setBrandPickerOpen(true)}
                    style={{ borderWidth:1, borderColor:colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || '#111827' }}
                  >
                    <Text style={{ color: colors.text }}>{profile.brand || "Выбрать марку"}</Text>
                  </TouchableOpacity>
                </View>

                {/* Модель / Год / Номер */}
                {[
                  { key:"model", label:"Модель", ph:"Camry" },
                  { key:"year",  label:"Год",    ph:"2018" },
                  { key:"plate", label:"Госномер", ph:"123ABC01" }
                ].map(f=>(
                  <View key={f.key} style={{ marginBottom:10 }}>
                    <Text style={{ color: colors.muted, marginBottom:6 }}>{f.label}</Text>
                    <TextInput
                      value={profile[f.key]}
                      onChangeText={(v)=>setProfile(p=>({...p, [f.key]: v}))}
                      placeholder={f.ph}
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || '#111827' }}
                    />
                  </View>
                ))}

                {/* VIN */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>VIN</Text>
                  <TextInput
  placeholder="VIN"
  placeholderTextColor={colors.subtext}
  value={profile.vin || ""}
  onChangeText={(t)=>{
    const v = (t||"").toUpperCase();
    setProfile(p=>({ ...p, vin: v }));
  }}
  onBlur={()=>{
    const v = (profile.vin||"").toUpperCase();
    if (isVinLike(v)) {
      const guessed = guessBrandByVIN(v);
      if (guessed && !profile.brand) {
        setProfile(p=>({ ...p, brand: guessed }));
      }
    }
  }}
  autoCapitalize="characters"
  style={{
    color: colors.text,
    backgroundColor: colors.card,
    borderColor: isVinLike(profile.vin||"") ? colors.border : '#ef4444',
    borderWidth:1, borderRadius:12, padding:10, marginBottom:10
  }}
/>
                  {vinError && <Text style={{ color:"#ef4444", marginTop:4 }}>VIN должен быть 9–20 символов (A–Z, 0–9)</Text>}
                  {/* VIN / Фото кнопки */}
                  <View style={{ flexDirection:'row', marginTop:8 }}>
                    <View style={{ flex:1, marginLeft:6 }}>
  <TouchableOpacity
    onPress={handlePickTechpass}
    style={{ paddingVertical:10, borderRadius:12, alignItems:'center', backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}
  >
    <Text style={{ color: colors.text, fontWeight:'700' }}>
      {profile.techpassUri ? 'Изменить фото ТП' : 'Фото техпаспорта'}
    </Text>
  </TouchableOpacity>
</View>
                   
                  </View>
                </View>
{profile.techpassUri ? (
  <View style={{ marginTop:10, alignItems:'center' }}>
    <Image source={{ uri: profile.techpassUri }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="cover" />
    <TouchableOpacity onPress={handleRemoveTechpass} style={{ marginTop:8, paddingVertical:6, paddingHorizontal:12, borderRadius:10, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}>
      <Text style={{ color: colors.text, fontWeight:'700' }}>Удалить фото</Text>
    </TouchableOpacity>
  </View>
) : null}
                {/* Пробег */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>Пробег, км</Text>
                  <TextInput
                    value={String(profile.mileage||"")}
                    onChangeText={(v)=>{
                      const digits = v.replace(/\D/g,"");
                      setProfile(p=>({...p, mileage: digits}));
                      setOdoError(digits.length===0);
                    }}
                    keyboardType="number-pad"
                    placeholder="123456"
                    placeholderTextColor={colors.muted}
                    style={{ color: colors.text, borderWidth:1.5, borderColor: odoError ? "#ef4444" : colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || '#111827' }}
                  />
                  {odoError && <Text style={{ color:"#ef4444", marginTop:4 }}>Введите пробег (только цифры)</Text>}
                </View>
              </ScrollView>

              {/* Кнопки профиля */}
              <View style={{ padding:16, paddingTop:0 }}>
                <View style={{ flexDirection:"row" }}>
                  <TouchableOpacity onPress={()=>setEditOpen(false)} style={{ flex:1, padding:12, borderRadius:12, alignItems:'center', backgroundColor: colors.card, marginRight:8, borderWidth:1, borderColor: colors.border }}>
                    <Text style={{ color:"#fff" }}>Отмена</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSaveProfile} style={{ flex:1, padding:12, borderRadius:12, alignItems:'center', backgroundColor: colors.primary||"#0ea5e9" }}>
                    <Text style={{ color:"#000", fontWeight:"800" }}>Сохранить</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

<Modal visible={pinsOpen} transparent animationType="fade" onRequestClose={()=>setPinsOpen(false)}>
  <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', padding:16 }}>
    <View style={{ backgroundColor: colors.card, borderRadius:16, padding:12, maxHeight:'80%', width:'92%', alignSelf:'center' }}>
      <Text style={{ color: colors.text, fontWeight:'800', marginBottom:8, fontSize:16 }}>Что показывать на главной «Моё авто»</Text>
      <ScrollView>
        {METRICS.map(m=>{
          const on = pins.includes(m.key);
          return (
            <TouchableOpacity key={m.key}
              onPress={()=>{
                const next = on ? pins.filter(k=>k!==m.key) : [...pins, m.key];
                savePins(next);
              }}
              style={{ paddingVertical:10, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderBottomWidth:1, borderBottomColor: colors.border }}
            >
              <Text style={{ color: colors.text }}>{m.label}</Text>
              <Text style={{ color: on ? '#22c55e' : colors.subtext }}>{on ? 'включено' : 'выкл'}</Text>
            </TouchableOpacity>
          );
        })}
        {(svc.custom||[]).map(c=>{
          const k = `custom:${c.id}`;
          const on = pins.includes(k);
          return (
            <TouchableOpacity key={k}
              onPress={()=>{
                const next = on ? pins.filter(x=>x!==k) : [...pins, k];
                savePins(next);
              }}
              style={{ paddingVertical:10, flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderBottomWidth:1, borderBottomColor: colors.border }}
            >
              <Text style={{ color: colors.text }}>Своя ТО: {c.name||'Без названия'}</Text>
              <Text style={{ color: on ? '#22c55e' : colors.subtext }}>{on ? 'включено' : 'выкл'}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={{ marginTop:8, alignItems:'flex-end' }}>
        <TouchableOpacity onPress={()=>setPinsOpen(false)} style={{ paddingVertical:8, paddingHorizontal:14, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight:'700' }}>Закрыть</Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>


      {/* Пикер марок */}
      <Modal transparent visible={brandPickerOpen} animationType="fade" onRequestClose={()=>setBrandPickerOpen(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', padding:16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius:16, padding:12, maxHeight:'70%' }}>
            <ScrollView>
              {["Toyota","Kia","Hyundai","Volkswagen","BMW","Mercedes","Lexus","Nissan","Mitsubishi","Renault","Skoda","Audi","Chevrolet","Geely"].map(b=>(
                <TouchableOpacity key={b} onPress={()=>{ setProfile(p=>({...p, brand:b})); setBrandPickerOpen(false); }} style={{ paddingVertical:10 }}>
                  <Text style={{ color: colors.text, fontWeight:'700' }}>{b}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ marginTop:8 }}>
              <TouchableOpacity onPress={()=>setBrandPickerOpen(false)} style={{ paddingVertical:10, borderRadius:12, alignItems:'center', backgroundColor: colors.card, borderWidth:1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight:'700' }}>Закрыть</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Модалка: Сервис */}
      <Modal visible={svcOpen} transparent animationType="slide" onRequestClose={()=>setSvcOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{ flex:1 }}>
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end' }}>
            <View style={{ backgroundColor: colors.bg, borderTopLeftRadius:18, borderTopRightRadius:18, maxHeight:'80%' }}>
              <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {[
                  { key:"nextTO", label:"Следующее ТО (YYYY-MM-DD)", ph:"2025-01-15" },
                  { key:"insuranceTo", label:"Страховка до (YYYY-MM-DD)", ph:"2025-06-01" },
                  { key:"inspectionTo", label:"Техосмотр до (YYYY-MM-DD)", ph:"2025-04-20" }
                ].map(f=>(
                  <View key={f.key} style={{ marginBottom:10 }}>
                    <Text style={{ color: colors.muted, marginBottom:6 }}>{f.label}</Text>
                    <TextInput
                      value={svc[f.key]}
                      onChangeText={(v)=>setSvc(p=>({...p, [f.key]: v}))}
                      placeholder={f.ph}
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || "#111827" }}
                    />
                  </View>
                ))}

                {/* Страховка: с/срок */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>Страховка с (YYYY-MM-DD)</Text>
                  <TextInput
                    value={svc.insuranceFrom}
                    onChangeText={(v)=>setSvc(p=>({...p, insuranceFrom:v}))}
                    placeholder="2025-01-01"
                    placeholderTextColor={colors.muted}
                    style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || "#111827" }}
                  />
                </View>
                <View style={{ flexDirection:"row", marginBottom:10 }}>
                  {[6,12].map(m=>(
                    <TouchableOpacity key={m} onPress={()=>setSvc(p=>({...p, insuranceTerm:m}))}
                      style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, marginRight:8, backgroundColor: svc.insuranceTerm===m ? (colors.primary||"#0ea5e9") : colors.card, borderWidth:1, borderColor: colors.border }}>
                      <Text style={{ color: svc.insuranceTerm===m ? "#000" : colors.text }}>{m} мес</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Техосмотр: с/срок (вручную) */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>Техосмотр с (YYYY-MM-DD)</Text>
                  <TextInput
                    value={svc.inspectionFrom}
                    onChangeText={(v)=>setSvc(p=>({...p, inspectionFrom:v}))}
                    placeholder="2025-01-01"
                    placeholderTextColor={colors.muted}
                    style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || "#111827" }}
                  />
                </View>
                <View style={{ flexDirection:"row", marginBottom:10, flexWrap:'wrap' }}>
                  {[3,6,9,12].map(m=>(
                    <TouchableOpacity key={m} onPress={()=>setSvc(p=>({...p, inspectionTerm:m}))}
                      style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, marginRight:8, marginBottom:8, backgroundColor: svc.inspectionTerm===m ? (colors.primary||"#0ea5e9") : colors.card, borderWidth:1, borderColor: colors.border }}>
                      <Text style={{ color: svc.inspectionTerm===m ? "#000" : colors.text }}>{m} мес</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Напоминания */}
                <View style={{ flexDirection:"row", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <Text style={{ color: colors.text, fontWeight:"600" }}>Напоминания</Text>
                  <Switch value={!!svc.remind} onValueChange={(v)=>setSvc(p=>({...p, remind:v}))} />
                </View>
                <View style={{ flexDirection:"row", marginBottom:10 }}>
                  <View style={{ flex:1, marginRight:6 }}>
                    <Text style={{ color: colors.muted, marginBottom:6 }}>За сколько дней</Text>
                    <TextInput
                      value={String(svc.remindDays??7)}
                      onChangeText={(v)=>setSvc(p=>({...p, remindDays: parseInt(v||"7",10)||7}))}
                      keyboardType="number-pad"
                      placeholder="7"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || "#111827" }}
                    />
                  </View>
                  <View style={{ flex:1, marginLeft:6 }}>
                    <Text style={{ color: colors.muted, marginBottom:6 }}>Порог по пробегу (км)</Text>
                    <TextInput
                      value={String(svc.remindKm??1000)}
                      onChangeText={(v)=>setSvc(p=>({...p, remindKm: parseInt(v||"1000",10)||1000}))}
                      keyboardType="number-pad"
                      placeholder="1000"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, backgroundColor: colors.input || "#111827" }}
                    />
                  </View>
                </View>

                {/* Заметки */}
                <View style={{ marginBottom:10 }}>
                  <Text style={{ color: colors.muted, marginBottom:6 }}>Заметки</Text>
                  <TextInput
                    value={svc.notes}
                    onChangeText={(v)=>setSvc(p=>({...p, notes:v}))}
                    placeholder="Например: поменять антифриз, купить зимние шины…"
                    placeholderTextColor={colors.muted}
                    multiline
                    style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10, minHeight:80, textAlignVertical:'top', backgroundColor: colors.input || '#111827' }}
                  />
                </View>

                {/* План ТО (редактор) */}
                <Text style={{ color: colors.text, fontWeight:'800', marginBottom:6 }}>План ТО (по пробегу)</Text>
                {(svc.plan||[]).map((it, idx)=>(
                  <View key={it.key} style={{ marginBottom:10, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10 }}>
                    <Text style={{ color: colors.subtext, marginBottom:6 }}>{it.title}</Text>

                    <Text style={{ color: colors.muted, marginBottom:4 }}>Последний пробег (км)</Text>
                    <TextInput
                      value={String(it.lastKm||'')}
                      onChangeText={(v)=>setSvc(p=>{ const plan=[...(p.plan||[])]; plan[idx]={...plan[idx], lastKm: v.replace(/\D/g,'')}; return {...p, plan}; })}
                      keyboardType="number-pad"
                      placeholder="120000"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, backgroundColor: colors.input || '#111827' }}
                    />

                    <Text style={{ color: colors.muted, marginVertical:6 }}>Интервал (км)</Text>
                    <View style={{ flexDirection:'row', flexWrap:'wrap' }}>
                      {(
                        it.key==='engine_oil'  ? [5000,7000,10000,'Свой'] :
                        it.key==='ps_fluid'    ? [10000,20000,'Свой']     :
                        it.key==='antifreeze'  ? [20000,30000,'Свой']     :
                        it.key==='gearbox'     ? [40000,50000,'Свой']     :
                        it.key==='axles'       ? [20000,30000,'Свой']     :
                                                 [20000,30000,'Свой']
                      ).map(opt=>(
                        <TouchableOpacity key={String(opt)}
                          onPress={()=>{ if(opt==='Свой') return; setSvc(p=>{ const plan=[...(p.plan||[])]; plan[idx]={...plan[idx], intervalKm:String(opt)}; return {...p, plan}; }); }}
                          style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:10, marginRight:8, marginBottom:8, backgroundColor: String(it.intervalKm)===String(opt) ? (colors.primary||'#0ea5e9') : colors.card, borderWidth:1, borderColor: colors.border }}>
                          <Text style={{ color: String(it.intervalKm)===String(opt) ? '#000' : colors.text }}>{String(opt)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <TextInput
                      value={String(it.intervalKm||'')}
                      onChangeText={(v)=>setSvc(p=>{ const plan=[...(p.plan||[])]; plan[idx]={...plan[idx], intervalKm: v.replace(/\D/g,'')}; return {...p, plan}; })}
                      keyboardType="number-pad"
                      placeholder="Свой интервал, км"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, backgroundColor: colors.input || '#111827', marginTop:6 }}
                    />
                  </View>
                ))}

                {/* Свои ТО */}
                <Text style={{ color: colors.text, fontWeight:'800', marginBottom:6 }}>Свои ТО</Text>
                <TouchableOpacity onPress={()=>setSvc(p=>({...p, custom:[...(p.custom||[]), { id: Date.now(), name:'', lastKm:'', intervalKm:'', note:'' }]}))}
                  style={{ paddingVertical:10, borderRadius:12, backgroundColor: colors.card, borderWidth:1, borderColor: colors.border, alignItems:'center', marginBottom:10 }}>
                  <Text style={{ color: colors.text, fontWeight:'700' }}>Добавить своё ТО</Text>
                </TouchableOpacity>

                {(svc.custom||[]).map((it, idx)=>(
                  <View key={it.id} style={{ marginBottom:10, borderWidth:1, borderColor: colors.border, borderRadius:12, padding:10 }}>
                    <Text style={{ color: colors.muted, marginBottom:6 }}>Название</Text>
                    <TextInput
                      value={it.name}
                      onChangeText={(v)=>setSvc(p=>{ const c=[...(p.custom||[])]; c[idx]={...c[idx], name:v}; return {...p, custom:c}; })}
                      placeholder="ГРМ / АКБ / Шины / Колодки…"
                      placeholderTextColor={colors.muted}
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, backgroundColor: colors.input || '#111827' }}
                    />
                    <View style={{ flexDirection:'row', marginTop:8 }}>
                      <View style={{ flex:1, marginRight:6 }}>
                        <Text style={{ color: colors.muted, marginBottom:6 }}>Последний пробег (км)</Text>
                        <TextInput
                          value={String(it.lastKm||'')}
                          onChangeText={(v)=>setSvc(p=>{ const c=[...(p.custom||[])]; c[idx]={...c[idx], lastKm: v.replace(/\D/g,'')}; return {...p, custom:c}; })}
                          keyboardType="number-pad"
                          placeholder="120000"
                          placeholderTextColor={colors.muted}
                          style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, backgroundColor: colors.input || '#111827' }}
                        />
                      </View>
                      <View style={{ flex:1, marginLeft:6 }}>
                        <Text style={{ color: colors.muted, marginBottom:6 }}>Интервал (км)</Text>
                        <TextInput
                          value={String(it.intervalKm||'')}
                          onChangeText={(v)=>setSvc(p=>{ const c=[...(p.custom||[])]; c[idx]={...c[idx], intervalKm: v.replace(/\D/g,'')}; return {...p, custom:c}; })}
                          keyboardType="number-pad"
                          placeholder="30000"
                          placeholderTextColor={colors.muted}
                          style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, backgroundColor: colors.input || '#111827' }}
                        />
                      </View>
                    </View>
                    <Text style={{ color: colors.muted, marginTop:8, marginBottom:6 }}>Комментарий</Text>
                    <TextInput
                      value={it.note||''}
                      onChangeText={(v)=>setSvc(p=>{ const c=[...(p.custom||[])]; c[idx]={...c[idx], note:v}; return {...p, custom:c}; })}
                      placeholder="Что меняли, артикулы…"
                      placeholderTextColor={colors.muted}
                      multiline
                      style={{ color: colors.text, borderWidth:1, borderColor: colors.border, borderRadius:10, padding:8, minHeight:60, textAlignVertical:'top', backgroundColor: colors.input || '#111827' }}
                    />
                    <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:8 }}>
                      <TouchableOpacity onPress={()=>setSvc(p=>{ const c=[...(p.custom||[])]; c.splice(idx,1); return {...p, custom:c}; })}
                        style={{ paddingVertical:6, paddingHorizontal:12, borderRadius:10, backgroundColor:'#ef4444' }}>
                        <Text style={{ color:'#fff', fontWeight:'700' }}>Удалить</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Кнопки сервиса */}
              <View style={{ padding:16, paddingTop:0 }}>
                <View style={{ flexDirection:"row" }}>
                  <TouchableOpacity onPress={()=>setSvcOpen(false)} style={{ flex:1, padding:12, borderRadius:12, alignItems:'center', backgroundColor: colors.card, marginRight:8, borderWidth:1, borderColor: colors.border }}>
                    <Text style={{ color:"#fff" }}>Отмена</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSaveSvc} style={{ flex:1, padding:12, borderRadius:12, alignItems:'center', backgroundColor: colors.primary||"#0ea5e9" }}>
                    <Text style={{ color:"#000", fontWeight:"800" }}>Сохранить</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}


// --- News ---
function NewsScreen(){
  const { colors } = useTheme();

  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>Новости</Text>
      <Card title="Лента">
        <Text style={tw`text-[#94a3b8]`}>2–3 раза в неделю: новости авто, изменения ПДД, обзоры. В разработке.</Text>
      </Card>
    </ScrollView>
  );
}

// --- FAQ / Комьюнити ---
function FAQScreen(){
  const { colors } = useTheme();
  const [idea, setIdea] = useState("");
  const [sent, setSent] = useState(false);
  function submit(){ if(!idea.trim()) return Alert.alert('Идея', 'Опишите в 1–2 предложениях'); sendEvent('idea', { idea: idea.trim() }); setSent(true); }
  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>FAQ / Комьюнити</Text>
      <Card title="Частые вопросы">
        <Text style={tw`text-[#94a3b8]`}>Как пользоваться, где данные, как отключить уведомления — добавим сюда.</Text>
      </Card>
      <Card title="Предложить идею">
        {!sent ? (
          <>
            <TextInput value={idea} onChangeText={setIdea} multiline placeholder="Опишите идею…" placeholderTextColor="#6b7280" style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl min-h-28`} />
            <Btn title="Отправить" onPress={submit} />
          </>
        ) : (
          <Text style={tw`text-green-400`}>Идея принята 🎉 Спасибо! Завтра сообщим статус.</Text>
        )}
      </Card>
    </ScrollView>
  );
}

// --- Поиск ---
function SearchScreen(){
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>Поиск</Text>
      <Card title="По приложению">
        <TextInput value={q} onChangeText={setQ} placeholder="Например: ПДД штраф, шиномонтаж" placeholderTextColor="#6b7280" style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl`} />
        <Text style={tw`text-[#94a3b8] mt-2`}>В разработке: поиск по разделам приложения и интернету с приватностью.</Text>
      </Card>
    </ScrollView>
  );
}

// --- ПДД (упрощённо) ---
function LawsScreen(){
  const { colors } = useTheme();
  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>ПДД / Кодексы</Text>
      <Card title="Популярные вопросы">
        <Text style={tw`text-[#94a3b8]`}>Здесь будут краткие статьи: превышение скорости, парковка, ремень, светофор. С указанием наказаний и источников. AI-помощник по ПДД — далее.</Text>
      </Card>
    </ScrollView>
  );
}

// --- Экраны-заглушки для совместимости ---
function CamerasScreen(){
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [list, setList] = useState([]);
  const [loc, setLoc] = useState(null);
  const [permStatus, setPermStatus] = useState(null);
  useEffect(()=>{ (async()=>{ let { status } = await Location.requestForegroundPermissionsAsync(); setPermStatus(status); if(status!=='granted'){ Alert.alert('Геолокация','Разрешение не выдано'); return;} const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); setLoc({lat:pos.coords.latitude, lon:pos.coords.longitude}); sendEvent('location_ok'); })(); },[]);
  function parseGeneric(raw){ const lines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const out=[]; for(const line of lines){ const clean=line.replace(/;|\t/g, ','); const parts=clean.split(',').map(s=>s.trim()); if(parts.length<2) continue; const lat=parseFloat(parts[0]); const lon=parseFloat(parts[1]); const speed=parts[2]?parseInt(parts[2]):null; if(!isFinite(lat)||!isFinite(lon)) continue; out.push({id:`${lat.toFixed(6)},${lon.toFixed(6)}`,lat,lon,speed}); } return out; }
  function parseSpeedCam(raw){ const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const out=[]; for(const line of lines){ const parts=line.split('|').map(s=>s.trim()); if(parts.length<6) continue; const lat=parseFloat(parts[2]); const lon=parseFloat(parts[3]); const speed=parseInt(parts[5]); if(!isFinite(lat)||!isFinite(lon)) continue; out.push({id:`${lat.toFixed(6)},${lon.toFixed(6)}`,lat,lon,speed:isFinite(speed)?speed:null}); } return out; }
  function parse(raw){ return raw.includes('|')?parseSpeedCam(raw):parseGeneric(raw); }
  const nearest = useMemo(()=>{ if(!loc||list.length===0) return null; let best=null; for(const c of list){ const d=haversine(loc.lat,loc.lon,c.lat,c.lon); if(!best||d<best.d) best={...c,d}; } return best; },[loc,list]);
  return (
    <ScrollView style={[tw`flex-1`, { backgroundColor: colors.bg }]} contentContainerStyle={tw`p-4`}>
      <Text style={tw`text-[#f1f5f9] text-xl font-extrabold mb-1`}>Камеры и алерты</Text>
      {permStatus && (<Text style={tw`mb-3 ${permStatus==='granted' ? 'text-green-400' : 'text-red-400'}`}>Геолокация: {permStatus==='granted'?'активна ✅':'нет доступа ❌'}</Text>)}
      <Card title="Импорт">
        <TextInput placeholder={'55.7558,37.6173,60\n43.2383,76.9453,80\n18952|KZ-1|51.1235493|71.4752136|1709|60|1713'} placeholderTextColor="#6b7280" value={text} onChangeText={setText} multiline style={tw`text-[#f1f5f9] bg-[#0f172a] p-3 rounded-xl min-h-36`} />
        <Btn title="Разобрать" onPress={()=>{ const parsed=parse(text); setList(parsed); sendEvent('cameras_import',{count:parsed.length}); }} />
      </Card>
      <Card title={`Список камер (${list.length})`}>
        {list.length===0? (<Text style={tw`text-[#94a3b8]`}>Пока пусто</Text>) : (
          <FlatList data={list} keyExtractor={(i)=>i.id} renderItem={({item})=> (
            <View style={tw`py-2 border-b border-[#1f2937] `}>
              <Text style={tw`text-[#f1f5f9]`}>{item.lat.toFixed(5)}, {item.lon.toFixed(5)} {item.speed?`• ${item.speed} км/ч`:''}</Text>
              {loc && (<Text style={tw`text-[#94a3b8]`}>~{haversine(loc.lat,loc.lon,item.lat,item.lon).toFixed(2)} км от вас</Text>)}
            </View>
          )} />
        )}
      </Card>
      <Card title="Ближайшая камера">
        {!nearest ? (<Text style={tw`text-[#94a3b8]`}>Недостаточно данных</Text>) : (
          <View>
            <Row label="Координаты" value={`${nearest.lat.toFixed(5)}, ${nearest.lon.toFixed(5)}`} />
            <Row label="Ограничение" value={nearest.speed? `${nearest.speed} км/ч` : '—'} />
            <Row label="Дистанция" value={`${nearest.d.toFixed(2)} км`} />
          </View>
        )}
      </Card>
    </ScrollView>
  );
}
// ---------- EXPENSES SCREEN ----------
function ExpensesScreen() {
  const { colors } = useTheme();
  const today = new Date();
  const [date, setDate] = React.useState(today);
  const [category, setCategory] = React.useState("fuel");          // ключ категории
  const [subtype, setSubtype] = React.useState("Бензин");          // для fuel
  const [price, setPrice] = React.useState("");                    // цена за литр (опц.)
  const [amount, setAmount] = React.useState("");                  // сумма расхода
  const [amountError, setAmountError] = React.useState(false);
  const [list, setList] = React.useState([]);                      // все записи (все даты)
  const amountRef = React.useRef(null);
  
  // FAB: позиция и перетаскивание
const [fabPos] = React.useState(new Animated.ValueXY({ x: 16, y: 24 }));

const saveFab = async (x, y) => {
  try {
    await AsyncStorage.setItem("expenses/fabPos", JSON.stringify({ x, y }));
  } catch (e) {
    console.log("FAB pos save error", e);
  }
};

const pan = React.useRef(PanResponder.create({
  onStartShouldSetPanResponder: () => true,
  onPanResponderMove: Animated.event([null, { dx: fabPos.x, dy: fabPos.y }], { useNativeDriver: false }),
  onPanResponderRelease: () => {
  fabPos.flattenOffset();

  const card = { w: 56, h: 56 };     // размер FAB
  const margin = 8;

  const gx = Math.max(margin, Math.min(fabPos.x.__getValue(), W - card.w - margin));
  const gy = Math.max(margin, Math.min(fabPos.y.__getValue(), H - card.h - 64)); // отступ от низа

  fabPos.setValue({ x: gx, y: gy });

  (async ()=>{
    try{ await AsyncStorage.setItem(FAB_KEY, JSON.stringify({ x: gx, y: gy })); }
    catch(e){ console.log('exp fab save pos', e); }
  })();
},
})).current;

const FAB_KEY = "expenses/fabPos";
const { width: W, height: H } = Dimensions.get('window');

// загрузка сохранённой позиции FAB (если есть)
React.useEffect(()=>{
  (async ()=>{
    try{
      const raw = await AsyncStorage.getItem(FAB_KEY);
      if(raw){
        const p = JSON.parse(raw);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          fabPos.setValue({ x: p.x, y: p.y });
        }
      }
    }catch(e){ console.log('exp fab load pos', e); }
  })();
}, [fabPos]);

    // Экспорт CSV
  const buildCSV = React.useCallback(() => {
    const header = ['date','category','subtype','sum','price'].join(',');
    const rows = list
      .slice()
      .sort((a,b)=> new Date(a.date) - new Date(b.date))
      .map(x => [
        new Date(x.date).toISOString().slice(0,10),
        x.cat,
        x.sub || '',
        (Number(x.sum)||0).toString().replace('.', ','),
        (x.price!=null ? String(x.price).replace('.', ',') : '')
      ].join(','));
    return [header, ...rows].join('\n');
  }, [list]);

  const shareCSV = async () => {
    try {
      const csv = buildCSV();
      if (!csv || !csv.length) { Alert.alert('Экспорт', 'Список пуст'); return; }
      await Share.share({ message: csv });
    } catch (e) {
      console.log('share csv error', e);
      Alert.alert('Экспорт', 'Не удалось поделиться CSV');
    }
  };




  // Утилиты
  const ddmmyy = (d) => {
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };
  const isSameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  const isSameMonth = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth();

  // Загрузка/сохранение всего списка
  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("expenses_all");
        setList(raw ? JSON.parse(raw) : []);
      } catch(e){ console.log("expenses_all load", e); }
    })();
  }, []);
  const saveAll = React.useCallback(async (arr) => {
    try { await AsyncStorage.setItem("expenses_all", JSON.stringify(arr)); }
    catch(e){ console.log("expenses_all save", e); }
  },[]);

  // Добавить запись
  const addExpense = async () => {
const sum = parseFloat(String(amount).replace(",", "."));
if (!isFinite(sum) || sum <= 0) {
setAmountError(true);
Alert.alert("Расходы", "Введи сумму больше 0");
return;
}
 setAmountError(false);
    const item = {
      id: Date.now(),
      date: date.toISOString(),    // сохраняем ISO, показываем d/m/y
      cat: category,
      sub: category==="fuel" ? subtype : null,
      price: category==="fuel" && price ? parseFloat(String(price).replace(",", ".")) : null,
      sum,
    };
    const next = [...list, item];
    setList(next);
    setAmount("");
    setAmountError(false);
    saveAll(next);
    await Haptics.selectionAsync();
  };

  // Фильтры
  const byDay = list.filter(x => isSameDay(new Date(x.date), date));
  
  const byMonth = list.filter(x => isSameMonth(new Date(x.date), date));

  // Итоги
  const totalDay = byDay.reduce((a,b)=>a+b.sum,0);
  const monthByCat = byMonth.reduce((acc, x) => {
    const key = x.cat + (x.cat==="fuel" && x.sub ? `:${x.sub}` : "");
    acc[key] = (acc[key]||0) + x.sum;
    return acc;
  }, {});
  const monthTotal = Object.values(monthByCat).reduce((a,b)=>a+b,0);
  // ТОП-3 по месяцe на основе уже посчитанных monthByCat и monthTotal
const monthTop3 = React.useMemo(() => {
  const entries = Object.entries(monthByCat)
    .sort((a,b)=> b[1]-a[1])
    .slice(0,3)
    .map(([key, sum]) => {
      const [cat, sub] = String(key).split(':');
      const base = CATEGORIES.find(c=>c.key===cat)?.label || cat;
      const label = sub ? `${base} (${sub})` : base;
      const pct = monthTotal > 0 ? Math.round((sum / monthTotal) * 100) : 0;
      return { key, label, sum, pct };
    });
  return entries;
}, [monthByCat, monthTotal]);


  // Навигация по дате (без сторонних библиотек)
  const shiftDate = (days) => {
    const d = new Date(date);
    d.setDate(d.getDate()+days);
    setDate(d);
  };

  // UI
  const CatChip = ({k, label}) => (
    <TouchableOpacity
      onPress={()=>{ setCategory(k); if(k!=="fuel"){ setSubtype(null); setPrice(""); } else if(!subtype){ setSubtype("Бензин"); } }}
      style={tw`${category===k ? "bg-cyan-400" : "bg-[#334155]"} px-3 py-1 rounded-full mr-2 mb-2`}
    >
      <Text style={tw`${category===k ? "text-black" : "text-[#f1f5f9]"} text-xs font-bold`}>{label}</Text>
    </TouchableOpacity>
  );
// === D-1 Filters (уникальные имена, чтобы не конфликтовать) ===
const [range, setRange] = React.useState('day'); // 'day'|'week'|'month'
// FAB position (перетаскивание)


function openAddExpense(){
  try { Haptics.selectionAsync(); } catch(e) {}
  if (amountRef && amountRef.current && typeof amountRef.current.focus === 'function') {
    amountRef.current.focus();
  }
}



function _startOfWeek(d=new Date()){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0..6, где 1 — понедельник в RU-логике
  const shift = (dow === 0 ? 6 : dow - 1); // сдвиг до понедельника
  x.setDate(x.getDate() - shift);
  x.setHours(0,0,0,0);
  return x.getTime();
}
function _endOfWeek(d=new Date()){
  const b = new Date(_startOfWeek(d));
  b.setDate(b.getDate() + 6);
  b.setHours(23,59,59,999);
  return b.getTime();
}

// безопасный парсер даты из твоего элемента списка (поддержка it.date | it.ts)
function _ts(x){
  if (!x) return 0;
  if (typeof x === 'number') return x;
  if (x instanceof Date) return x.getTime();
  const d = new Date(x);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

const _now = new Date();
const _dayFrom = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate()).getTime();
const _dayTo   = _dayFrom + 24*60*60*1000 - 1;
const _weekFrom = _startOfWeek(_now);
const _weekTo   = _endOfWeek(_now);
const _monthFrom = new Date(_now.getFullYear(), _now.getMonth(), 1).getTime();
const _monthTo   = new Date(_now.getFullYear(), _now.getMonth()+1, 0, 23,59,59,999).getTime();

const filteredList = React.useMemo(()=>{
  const src = Array.isArray(list) ? list : [];
    // Локально считаем границы периода (чтобы не тащить deps снаружи)
  const now = new Date();
  const dayFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayTo   = dayFrom + 24*60*60*1000 - 1;
  const startOfWeek = (d)=>{
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay();
    const shift = (dow === 0 ? 6 : dow - 1);
    x.setDate(x.getDate() - shift);
    x.setHours(0,0,0,0);
    return x.getTime();
  };
  const endOfWeek = (d)=>{
    const b = new Date(startOfWeek(d));
    b.setDate(b.getDate() + 6);
    b.setHours(23,59,59,999);
    return b.getTime();
  };
  const weekFrom = startOfWeek(now);
  const weekTo   = endOfWeek(now);
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthTo   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999).getTime();
  if (range === 'day') {
    return src.filter(it => { const t=_ts(it.date||it.ts); return t>=dayFrom && t<=dayTo; })
              .sort((a,b)=>_ts(b.date||b.ts)-_ts(a.date||a.ts));
  }
  if (range === 'week') {
    return src.filter(it => { const t=_ts(it.date||it.ts); return t>=weekFrom && t<=weekTo; })
              .sort((a,b)=>_ts(b.date||b.ts)-_ts(a.date||a.ts));
  }
  // month (по текущему месяцу)
  return src.filter(it => { const t=_ts(it.date||it.ts); return t>=monthFrom && t<=monthTo; })
            .sort((a,b)=>_ts(b.date||b.ts)-_ts(a.date||a.ts));
}, [list, range]);
// === /D-1 Filters ===

  return (
    <SafeAreaView style={[tw`flex-1`, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={tw`p-4 pb-24`}>
        {/* Дата */}
        <Card title="Дата">
          <View style={[tw`flex-row items-center justify-between`, { paddingRight: 8 }]}>
            <TouchableOpacity onPress={()=>shiftDate(-1)} style={tw`bg-[#334155] px-3 py-2 rounded-xl`}>
              <Text style={tw`text-[#f1f5f9]`}>◀</Text>
            </TouchableOpacity>
            <Text style={tw`text-[#f1f5f9] text-lg font-extrabold`}>{ddmmyy(date)}</Text>
            <TouchableOpacity onPress={()=>shiftDate(1)} style={tw`bg-[#334155] px-3 py-2 rounded-xl`}>
              <Text style={tw`text-[#f1f5f9]`}>▶</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Категория */}
        <Card title="Категория">
          <View style={tw`flex-row flex-wrap`}>
            {CATEGORIES.map(c => <CatChip key={c.key} k={c.key} label={c.label} />)}
          </View>
          {category==="fuel" && (
            <>
              <Text style={tw`text-[#94a3b8] mt-2`}>Подтип топлива</Text>
              <View style={tw`flex-row mt-1`}>
                {["Бензин","Дизель"].map(s => (
                  <TouchableOpacity key={s} onPress={()=>setSubtype(s)}
                    style={tw`${subtype===s ? "bg-cyan-400" : "bg-[#334155]"} px-3 py-1 rounded-full mr-2`}
                  >
                    <Text style={tw`${subtype===s ? "text-black" : "text-[#f1f5f9]"} text-xs font-bold`}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={tw`text-[#94a3b8] mt-2`}>Цена за литр (опционально)</Text>
              <TextInput
                style={tw`bg-[#111827] text-[#f1f5f9] p-3 rounded-xl mt-1`}
                keyboardType="numeric"
                placeholder="Напр. 270"
                placeholderTextColor="#6b7280"
                value={price}
                onChangeText={setPrice}
              />
            </>
          )}
        </Card>

        {/* Ввод суммы */}
        <Card title="Сумма">
          <View style={tw`flex-row items-center`}>
            <TextInput
            ref={amountRef}
              style={[tw`flex-1 bg-[#111827] text-[#f1f5f9] p-3 rounded-xl mr-2`, amountError ? { borderColor:'#ef4444', borderWidth:1.5 } : null
  ]}
              keyboardType="numeric"
              placeholder="Напр. 2500"
              placeholderTextColor="#6b7280"
              value={amount}
              onChangeText={(v)=>{setAmount(v);
    if (amountError) {
      const n = parseFloat(String(v).replace(",", "."));
      if (isFinite(n) && n > 0) setAmountError(false);
    }
  }}
              returnKeyType="done"
              onSubmitEditing={addExpense}
            />
            <TouchableOpacity onPress={addExpense} style={tw`bg-cyan-400 p-3 rounded-xl`}>
              <Text style={tw`text-black font-bold`}>Добавить</Text>
            </TouchableOpacity>
          </View>
        </Card>

     {/* Фильтры периода */}
<View style={tw`flex-row mb-3`}>
  {[
    {id:'day',   label:'Сегодня'},
    {id:'week',  label:'Неделя'},
    {id:'month', label:'Месяц'},
  ].map(t => (
    <TouchableOpacity
      key={t.id}
      onPress={()=>setRange(t.id)}
      style={[
        tw`px-3 py-2 rounded-xl mr-2 border`,
        range===t.id
          ? { backgroundColor: '#0891b2', borderColor:'#0891b2' }
          : { backgroundColor: 'transparent', borderColor: '#334155' }
      ]}
    >
      <Text style={range===t.id ? tw`text-black font-extrabold` : tw`text-slate-200`}>{t.label}</Text>
    </TouchableOpacity>
  ))}
</View>

         {/* Список за день */}
        {range==='day' && (
  <>
    {/* Список за день */}
        <Card title="Сегодня">
          {byDay.length===0 ? (
            <Text style={tw`text-[#94a3b8]`}>Расходов за день нет.</Text>
          ) : (
            byDay.map(it => (
              <TouchableOpacity
                key={it.id}
                onLongPress={()=>{
                  Alert.alert(
                    'Удалить запись?',
                    `${CATEGORIES.find(c=>c.key===it.cat)?.label || it.cat}${it.cat==="fuel" && it.sub?` (${it.sub})`:""} — ${it.sum.toFixed(2)}`,
                    [
                      { text:'Отмена', style:'cancel' },
                      {
                        text:'Удалить',
                        style:'destructive',
                        onPress: async ()=>{
                          const updated = list.filter(x => x.id !== it.id);
                          setList(updated);
                          await saveAll(updated);
                        }
                      }
                    ]
                  );
                }}
                delayLongPress={400}
                style={tw`flex-row justify-between py-1`}
              >
                <Text style={tw`text-[#f1f5f9]`}>
                  {CATEGORIES.find(c=>c.key===it.cat)?.label}{it.cat==="fuel" && it.sub?` (${it.sub})`:""}
                </Text>
                <Text style={tw`text-cyan-300`}>{it.sum.toFixed(2)}</Text>
              </TouchableOpacity>
            ))
          )}
          <View style={tw`border-t border-[#334155] mt-2 pt-2 flex-row justify-between`}>
            <Text style={tw`text-[#94a3b8]`}>Итого сегодня</Text>
            <Text style={tw`text-[#f1f5f9] font-extrabold`}>{totalDay.toFixed(2)}</Text>
          </View>
        </Card>
  </>
)}
{range==='week' && (
  <>
    <Card title="Эта неделя">
      {filteredList.length===0 ? (
        <Text style={tw`text-[#94a3b8]`}>Расходов за неделю нет.</Text>
      ) : (
        filteredList.map(it => (
          <View key={it.id} style={tw`flex-row justify-between py-1`}>
            <Text style={tw`text-[#f1f5f9]`}>
              {CATEGORIES.find(c=>c.key===it.cat)?.label}{it.cat==="fuel" && it.sub?` (${it.sub})`:""}
            </Text>
            <Text style={tw`text-cyan-300`}>{Number(it.sum||0).toFixed(2)}</Text>
          </View>
        ))
      )}
    </Card>
  </>
)}

{range==='month' && (
  <>
    <Card title="Этот месяц (операции)">
      {filteredList.length===0 ? (
        <Text style={tw`text-[#94a3b8]`}>Расходов за месяц нет.</Text>
      ) : (
        filteredList.map(it => (
          <View key={it.id} style={tw`flex-row justify-between py-1`}>
            <Text style={tw`text-[#f1f5f9]`}>
              {CATEGORIES.find(c=>c.key===it.cat)?.label}{it.cat==="fuel" && it.sub?` (${it.sub})`:""}
            </Text>
            <Text style={tw`text-cyan-300`}>{Number(it.sum||0).toFixed(2)}</Text>
          </View>
        ))
      )}
    </Card>
  </>
)}

        {/* Итого за месяц по видам затрат */}
        <Card title="Итого за месяц по видам">
          {Object.keys(monthByCat).length===0 ? (
            <Text style={tw`text-[#94a3b8]`}>Данных за месяц пока нет.</Text>
          ) : (
            Object.entries(monthByCat).map(([k,v])=>(
              <View key={k} style={tw`flex-row justify-between py-1`}>
                <Text style={tw`text-[#f1f5f9]`} numberOfLines={1} ellipsizeMode="tail">
                  {(() => {
                    const [cat, sub] = k.split(":");
                    const label = CATEGORIES.find(c=>c.key===cat)?.label || cat;
                    return sub ? `${label} (${sub})` : label;
                  })()}
                </Text>
                <Text style={tw`text-cyan-300`}>{v.toFixed(2)}</Text>
              </View>
            ))
          )}
          
          <View style={tw`border-t border-[#334155] mt-2 pt-2`}>
            {monthTop3.length > 0 && (
              <View>
                <Text style={tw`text-[#94a3b8] mb-1`}>Топ-3 категории</Text>
                {monthTop3.map(row => (
                  <View key={row.key} style={tw`flex-row justify-between py-1`}>
                    <Text numberOfLines={1} style={tw`text-slate-200`}>{row.label}</Text>
                    <Text numberOfLines={1} style={tw`text-slate-300`}>{row.pct}% · {row.sum.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          

            <Text style={tw`text-[#94a3b8]`}>Итого месяц</Text>
            <Text style={tw`text-[#f1f5f9] font-extrabold`}>{monthTotal.toFixed(2)}</Text>
          </View>
        </Card>
                {/* Экспорт */}
        <View style={tw`mt-3`}>
          <TouchableOpacity onPress={shareCSV} style={tw`bg-[#0ea5e9] p-3 rounded-xl`}>
            <Text style={tw`text-black font-extrabold`}>Экспорт CSV</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
{/* FAB: перетаскиваемая кнопка добавления */}
<Animated.View
  {...pan.panHandlers}
  style={[
    { position: "absolute", right: 16, bottom: 24, zIndex: 999, elevation: 10 },
    { transform: [{ translateX: fabPos.x }, { translateY: fabPos.y }] }
  ]}
  pointerEvents="box-none"
>
  <TouchableOpacity
    onPress={openAddExpense}
    activeOpacity={0.9}
    style={{
      width: 56, height: 56, borderRadius: 28,
      alignItems: "center", justifyContent: "center",
      backgroundColor: "#22d3ee",
      borderWidth: 1, borderColor: "#1f2937"
    }}
  >
    <Text style={{ color: "#111827", fontWeight: "900", fontSize: 22 }}>＋</Text>
  </TouchableOpacity>
</Animated.View>

    </SafeAreaView>
  );
}

// --- Прочие экраны из предыдущей версии для совместимости ---
function ContactsScreen(){ const { colors } = useTheme(); return (<ScrollView style={tw`flex-1 bg-[#0b0b0f]`} contentContainerStyle={tw`p-4`}><Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>Контакты</Text><Text style={tw`text-[#94a3b8]`}>Поддержка: support@joldas.kz{"\n"}Партнёрам: partners@joldas.kz</Text></ScrollView>); }
function AboutScreen(){ const { colors } = useTheme(); return (<ScrollView style={tw`flex-1 bg-[#0b0b0f]`} contentContainerStyle={tw`p-4`}><Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>О приложении</Text><Text style={tw`text-[#94a3b8]`}>MVP для микротеста. Разделы "в разработке" содержат описание будущего функционала.</Text></ScrollView>); }
function HistoryScreen(){ const [items,setItems]=useState([]); useEffect(()=>{(async()=>{ const raw=await AsyncStorage.getItem('history'); const arr=raw?JSON.parse(raw):[]; setItems(arr.reverse()); })();},[]); return (<ScrollView style={tw`flex-1 bg-[#0b0b0f]`} contentContainerStyle={tw`p-4`}><Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 8 }}>История</Text><Card title={`События (${items.length})`}>{items.length===0?(<Text style={tw`text-[#94a3b8]`}>Пока пусто</Text>):(<FlatList data={items} keyExtractor={(_,i)=>String(i)} renderItem={({item})=>(<View style={tw`py-2 border-b border-[#1f2937] `}><Text style={tw`text-slate-300`}>{new Date(item.ts).toLocaleString()}</Text><Text style={tw`text-[#f1f5f9] font-bold`}>{item.name}</Text>{Object.keys(item).filter(k=>k!=='name'&&k!=='ts').length>0 && (<Text style={tw`text-[#94a3b8]`}>{JSON.stringify(item)}</Text>)}</View>)} />)}</Card></ScrollView>); }

// ----------------- APP / НАВИГАЦИЯ -----------------
const Stack = createStackNavigator();

export default function App(){
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
    <ThemeProvider>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#e2e8f0", headerTitleStyle: { fontWeight: "800" } }}>
        <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown:false }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "DriveAssist" }} />
        <Stack.Screen name="Navigator" component={NavigatorScreen} options={{ title: "Навигатор" }} />
        <Stack.Screen name="Cameras" component={CamerasScreen} options={{ title: "Камеры" }} />
        <Stack.Screen name="Situation" component={SituationScreen} options={{ title: "Ситуация" }} />
        <Stack.Screen name="SOS" component={SOSScreen} options={{ title: "SOS" }} />
        <Stack.Screen name="AiJoldas" component={AiJoldasScreen} options={{ title: "AiJoldas" }} />
        <Stack.Screen name="MyCar" component={MyCarScreen} options={{ title: "Моё авто" }} />
        <Stack.Screen name="News" component={NewsScreen} options={{ title: "Новости" }} />
        <Stack.Screen name="FAQ" component={FAQScreen} options={{ title: "FAQ/Комьюнити" }} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Поиск" }} />
        <Stack.Screen name="Laws" component={LawsScreen} options={{ title: "ПДД" }} />
        <Stack.Screen name="Contacts" component={ContactsScreen} options={{ title: "Контакты" }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: "История" }} />
        <Stack.Screen name="Expenses" component={ExpensesScreen} options={{ title: "Расходы" }} />
      </Stack.Navigator>
    </NavigationContainer>
    </ThemeProvider>
     </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
