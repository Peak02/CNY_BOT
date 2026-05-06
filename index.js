const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mybot2024";
const ADMIN_PSID = process.env.ADMIN_PSID;

let rates = { cny_buy: 0, cny_sell: 0, updatedAt: null };
const sessions = {};

const FAQ = {
  "алипай": "Бид Alipay дансаар CNY шилжүүлэг хийдэг. Захиалга өгөхдөө 'захиалга' гэж бичнэ үү.",
  "хэрхэн": "1️⃣ Ханш шалгах → 'ханш' бичнэ\n2️⃣ Захиалга өгөх → 'захиалга' бичнэ\n3️⃣ Манай оператортой холбогдох → 'оператор' бичнэ",
  "хэзээ": "Бид 09:00–21:00 цагт ажилладаг.",
  "хурдан": "Шилжүүлэг дунджаар 2 минутад хийгддэг ✅",
  "оператор": "Захиалга өгсний дараа манай оператор 2 минут дотор холбогдоно ✅",
};

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);
  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      if (event.message && !event.message.is_echo) {
        await handleMessage(event.sender.id, event.message.text || "");
      } else if (event.postback) {
        await handleMessage(event.sender.id, event.postback.payload);
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

async function handleMessage(psid, text) {
  const lower = text.toLowerCase().trim();

  if (psid === ADMIN_PSID) {
    const setMatch = lower.match(/^set\s+(\d+)\s+(\d+)$/);
    if (setMatch) {
      rates.cny_sell = parseInt(setMatch[1]);
      rates.cny_buy = parseInt(setMatch[2]);
      rates.updatedAt = new Date().toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
      await sendText(psid, `✅ Ханш тохируулагдлаа:\nЗарах: ${rates.cny_sell} ₮/¥\nАвах: ${rates.cny_buy} ₮/¥`);
      return;
    }
  }

  if (sessions[psid] && sessions[psid].step) {
    await handleOrderFlow(psid, text);
    return;
  }

  if (lower.includes("ханш") || lower.includes("курс") || lower.includes("үнэ")) {
    if (!rates.cny_sell) {
      await sendText(psid, "⏳ Өнөөдрийн ханш тун удахгүй шинэчлэгдэнэ.");
    } else {
      await sendText(psid, `💱 Өнөөдрийн ханш\n\n🟢 CNY зарах (MNT→CNY): ${rates.cny_sell} ₮/¥\n🔴 CNY авах (CNY→MNT): ${rates.cny_buy} ₮/¥\n\n🕐 ${rates.updatedAt}\n\nЗахиалга өгөхдөө 'захиалга' гэж бичнэ үү ✅`);
    }
    return;
  }

  if (lower.includes("захиалга") || lower.includes("order")) {
    if (!rates.cny_sell) {
      await sendText(psid, "⏳ Ханш одоогоор байхгүй. 09:00 цагаас шалгана уу.");
      return;
    }
    sessions[psid] = { step: "choose_type", data: {} };
    await sendButtons(psid, "Та юу хийхийг хүсч байна вэ?", [
      { type: "postback", title: "💵 MNT → CNY (юань авах)", payload: "TYPE_BUY" },
      { type: "postback", title: "💴 CNY → MNT (юань зарах)", payload: "TYPE_SELL" },
    ]);
    return;
  }

  for (const [keyword, answer] of Object.entries(FAQ)) {
    if (lower.includes(keyword)) {
      await sendText(psid, answer);
      return;
    }
  }

  if (lower.match(/^(сайн|hello|hi|байна уу)/)) {
    await sendText(psid, `Сайн байна уу! 👋\n\nБид CNY/Alipay валют солилцооны үйлчилгээ үзүүлдэг.\n\n• 'ханш' → өнөөдрийн ханш\n• 'захиалга' → юань авах/зарах`);
    return;
  }

  await sendText(psid, "Уучлаарай 😊 'ханш' эсвэл 'захиалга' гэж бичнэ үү.");
}

async function handleOrderFlow(psid, text) {
  const session = sessions[psid];

  if (text === "TYPE_BUY" || text === "TYPE_SELL") {
    session.data.type = text === "TYPE_BUY" ? "buy" : "sell";
    session.step = "enter_amount";
    const label = session.data.type === "buy" ? "MNT (төгрөг)" : "CNY (юань)";
    await sendText(psid, `Хэдэн ${label} солихыг хүсч байна вэ?\n\nДүнгээ бичнэ үү (жишээ: 500000)`);
    return;
  }

  if (session.step === "enter_amount") {
    const amount = parseInt(text.replace(/[^0-9]/g, ""));
    if (!amount || amount < 1000) {
      await sendText(psid, "❌ Зөв дүн оруулна уу (дор хаяж 1,000)");
      return;
    }
    session.data.amount = amount;
    session.step = "enter_name";
    let estimate = session.data.type === "buy"
      ? `≈ ${Math.floor(amount / rates.cny_sell).toLocaleString()} CNY авна`
      : `≈ ${(amount * rates.cny_buy).toLocaleString()} MNT авна`;
    await sendText(psid, `✅ ${estimate}\n\nТаны нэрийг оруулна уу:`);
    return;
  }

  if (session.step === "enter_name") {
    session.data.name = text;
    session.step = "enter_phone";
    await sendText(psid, "Утасны дугаараа оруулна уу:");
    return;
  }

  if (session.step === "enter_phone") {
    session.data.phone = text;
    const order = session.data;
    const typeLabel = order.type === "buy" ? "MNT → CNY" : "CNY → MNT";
    await sendText(psid, `🎉 Захиалга баталгаажлаа!\n\n• Төрөл: ${typeLabel}\n• Дүн: ${order.amount.toLocaleString()}\n• Нэр: ${order.name}\n• Утас: ${order.phone}\n\nМанай оператор 2 минут дотор холбогдоно ✅`);
    delete sessions[psid];
    return;
  }
}

async function sendText(psid, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      { recipient: { id: psid }, message: { text } }
    );
  } catch (e) {
    console.error("sendText error:", e.response?.data || e.message);
  }
}

async function sendButtons(psid, text, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: psid },
        message: {
          attachment: {
            type: "template",
            payload: { template_type: "button", text, buttons },
          },
        },
      }
    );
  } catch (e) {
    console.error("sendButtons error:", e.response?.data || e.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot ажиллаж байна: port ${PORT}`));
