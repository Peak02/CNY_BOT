const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ========================
// ТОХИРГОО (Config)
// ========================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mybot2024";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_PSID = process.env.ADMIN_PSID; // Чиний Facebook PSID

// ========================
// ХАНШ (өдөр бүр тохируулна)
// ========================
let rates = {
  cny_buy: 0,   // CNY авах (харилцагчаас): 1 CNY = ? MNT
  cny_sell: 0,  // CNY зарах (харилцагчид): 1 CNY = ? MNT
  updatedAt: null,
};

// ========================
// ЗАХИАЛГЫН ТӨЛӨВ (session)
// ========================
const sessions = {}; // { psid: { step, data } }

// ========================
// FAQ
// ========================
const FAQ = {
  "алипай": "Бид Alipay дансаар CNY шилжүүлэг хийдэг. Захиалга өгөхдөө 'захиалга' гэж бичнэ үү.",
  "хэрхэн": "1️⃣ Ханш шалгах → 'ханш' бичнэ\n2️⃣ Захиалга өгөх → 'захиалга' бичнэ\n3️⃣ Манай оператортой холбогдох → 'оператор' бичнэ",
  "хэзээ": "Бид 09:00–21:00 цагт ажилладаг.",
  "хурдан": "Шилжүүлэг дунджаар 2 минутад хийгддэг ✅",
  "утас": "Захиалга өгсний дараа манай оператор таньтай холбогдоно.",
  "оператор": "Захиалга өгсний дараа манай оператор таньтай 2 минут дотор холбогдоно ✅",
};

// ========================
// WEBHOOK VERIFY
// ========================
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

// ========================
// WEBHOOK RECEIVE
// ========================
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  for (const entry of body.entry) {
    for (const event of entry.messaging) {
      if (event.message && !event.message.is_echo) {
        await handleMessage(event.sender.id, event.message.text || "");
      }
    }
  }
  res.status(200).send("EVENT_RECEIVED");
});

// ========================
// МЕССЕЖ БОЛОВСРУУЛАХ
// ========================
async function handleMessage(psid, text)
{
  const lower = text.toLowerCase().trim();

  // --- ADMIN команд ---
  if (psid === ADMIN_PSID) {
    // Ханш тохируулах: "set 360 355"
    const setMatch = lower.match(/^set\s+(\d+)\s+(\d+)$/);
    if (setMatch) {
      rates.cny_sell = parseInt(setMatch[1]);
      rates.cny_buy = parseInt(setMatch[2]);
      rates.updatedAt = new Date().toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
      await sendText(psid, `✅ Ханш тохируулагдлаа:\nЗарах: ${rates.cny_sell} MNT/CNY\nАвах: ${rates.cny_buy} MNT/CNY`);
      return;
    }
    // Захиалгуудыг харах: "orders"
    if (lower === "orders") {
      await sendText(psid, "📋 Захиалгын жагсаалт Telegram-д харагдана.");
      return;
    }
  }

  // --- SESSION шалгах (захиалга flow) ---
  if (sessions[psid]) {
    await handleOrderFlow(psid, text);
    return;
  }

  // --- ХАНШ ---
  if (lower.includes("ханш") || lower.includes("курс") || lower.includes("price") || lower.includes("үнэ")) {
    if (!rates.cny_sell) {
      await sendText(psid, "⏳ Өнөөдрийн ханш тун удахгүй шинэчлэгдэнэ. Дахин шалгана уу.");
    } else {
      await sendText(psid, `💱 Өнөөдрийн ханш\n\n🔴 CNY авах (таны CNY → MNT): ${rates.cny_buy} ₮/¥\n🟢 CNY зарах (таны MNT → CNY): ${rates.cny_sell} ₮/¥\n\n🕐 ${rates.updatedAt}\n\nЗахиалга өгөхдөө 'захиалга' гэж бичнэ үү ✅`);
    }
    return;
  }

  // --- ЗАХИАЛГА ---
  if (lower.includes("захиалга") || lower.includes("авах") || lower.includes("зарах") || lower.includes("order")) {
    if (!rates.cny_sell) {
      await sendText(psid, "⏳ Ханш одоогоор байхгүй байна. 09:00 цагаас шалгана уу.");
      return;
    }
    sessions[psid] = { step: "choose_type", data: {} };
    await sendButtons(psid, "Та юу хийхийг хүсч байна вэ?", [
      { type: "postback", title: "💵 MNT → CNY (юань авах)", payload: "TYPE_BUY" },
      { type: "postback", title: "💴 CNY → MNT (юань зарах)", payload: "TYPE_SELL" },
    ]);
    return;
  }

  // --- FAQ ---
  for (const [keyword, answer] of Object.entries(FAQ)) {
    if (lower.includes(keyword)) {
      await sendText(psid, answer);
      return;
    }
  }

  // --- Мэндчилгээ ---
  if (lower.match(/^(сайн|сайн уу|hello|hi|байна уу|нүүр)/)) {
    await sendText(psid, `Сайн байна уу! 👋\n\nБид CNY/Alipay валют солилцооны үйлчилгээ үзүүлдэг.\n\n📌 Дараах зүйлийг бичнэ үү:\n• 'ханш' → өнөөдрийн ханш\n• 'захиалга' → юань авах/зарах\n• 'хэрхэн' → хэрхэн ажилладаг вэ`);
    return;
  }

  // --- AI хариулт ---
  await sendAIReply(psid, text);
}

// ========================
// ЗАХИАЛГЫН FLOW
// ========================
app.post("/webhook/postback", async (req, res) => { res.sendStatus(200); });

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

    let estimate = "";
    if (session.data.type === "buy") {
      const cny = Math.floor(amount / rates.cny_sell);
      estimate = `≈ ${cny.toLocaleString()} CNY авна`;
    } else {
      const mnt = amount * rates.cny_buy;
      estimate = `≈ ${mnt.toLocaleString()} MNT авна`;
    }

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
    session.step = null;

    const order = session.data;
    const typeLabel = order.type === "buy" ? "MNT → CNY (юань авах)" : "CNY → MNT (юань зарах)";
    const summary = `🎉 Захиалга баталгаажлаа!\n\n📋 Дэлгэрэнгүй:\n• Төрөл: ${typeLabel}\n• Дүн: ${order.amount.toLocaleString()}\n• Нэр: ${order.name}\n• Утас: ${order.phone}\n\nМанай оператор 2 минут дотор холбогдоно ✅`;
    await sendText(psid, summary);

    // Telegram мэдэгдэл
    await sendTelegramNotification(
      `🔔 ШИНЭ ЗАХИАЛГА\n\n• Төрөл: ${typeLabel}\n• Дүн: ${order.amount.toLocaleString()}\n• Нэр: ${order.name}\n• Утас: ${order.phone}\n• Ханш: ${order.type === "buy" ? rates.cny_sell : rates.cny_buy} ₮/¥`
    );

    delete sessions[psid];
    return;
  }
}

// Postback event handle
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

// ========================
// AI ХАРИУЛТ (Claude)
// ========================
async function sendAIReply(psid, userText) {
  try {
    const rateInfo = rates.cny_sell
      ? `Өнөөдрийн ханш: CNY зарах ${rates.cny_sell}₮, CNY авах ${rates.cny_buy}₮`
      : "Ханш одоогоор байхгүй.";

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `Та CNY/Alipay валют солилцооны бизнесийн туслах chatbot юм. Монголоор хариулна уу. Богино, тодорхой хариулт өгнө үү. ${rateInfo}. Захиалга өгөхийг хүсвэл 'захиалга' бичихийг хэлнэ үү. Ажиллах цаг: 09:00-21:00.`,
        messages: [{ role: "user", content: userText }],
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
      }
    );

    const reply = response.data.content[0].text;
    await sendText(psid, reply);
  } catch (err) {
    await sendText(psid, "Уучлаарай, асуултыг ойлгосонгүй. 'ханш' эсвэл 'захиалга' гэж бичнэ үү.");
  }
}

// ========================
// MESSENGER SEND FUNCTIONS
// ========================
async function sendText(psid, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { recipient: { id: psid }, message: { text } }
  );
}

async function sendButtons(psid, text, buttons) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      recipient: { id: psid },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons,
          },
        },
      },
    }
  );
}

// ========================
// TELEGRAM МЭДЭГДЭЛ
// ========================
async function sendTelegramNotification(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

// ========================
// START
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot ажиллаж байна: port ${PORT}`));

