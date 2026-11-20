const axios = require('axios');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

const port = process.env.PORT || 8080;
//const port = 8080;

const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite', systemInstruction: 'You are a friendly, natural conversation partner. Keep replies short, usually one to three sentences, and talk like a person in a chat, not like a document. Ask a brief follow-up question when it helps the conversation move on. Use plain language. For questions about current weather, news, prices, or events, use Google Search and give the answer conversationally, mentioning the date when it matters.'});

app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
//app.use(express.json());

app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

const filePath = path.join(__dirname, 'Excel', 'Create_Account.xlsx');
//const filePath = 'C:/Users/SRI_SAR/project/Excel/Create_Account.xlsx';

/*async function generateParagraph(prompt) {
  try {
    const result = await model.generateContent([prompt]);
    //console.log('API response:', JSON.stringify(result, null, 2));
    if (result.response && result.response.candidates && result.response.candidates.length > 0) {
      return result.response.candidates[0].content.parts[0].text;
    } else {
      return 'Sorry, no response generated.';
    }
  } catch (error) {
    console.error('Error generating paragraph:', error);
    return 'Sorry, an error occurred while generating the paragraph.';
  }
}*/


app.get('/Home_Page.html', (req, res) => {
  const user = req.session.user || null;
  res.render('home_page', { user });
});

app.post('/register', (req, res) => {
  try {
    const { prompt, username, email, phone, streetaddress, suburb, state, postcode, country, password } = req.body;
    let workbook, worksheet;
    if (fs.existsSync(filePath)) {
      workbook = XLSX.readFile(filePath);
      worksheet = workbook.Sheets[workbook.SheetNames[0]];
    } else {
      workbook = XLSX.utils.book_new();
      worksheet = XLSX.utils.aoa_to_sheet([['username', 'email', 'phone', 'address', 'password']]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Accounts');
    }
    const address = `${streetaddress}, ${suburb}, ${state}, ${postcode}, ${country}`;
    const newData = [[username, email, phone, address, password]];
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const startRow = range.e.r + 1;
    XLSX.utils.sheet_add_aoa(worksheet, newData, { origin: -1 });
    //worksheet['!ref'] = XLSX.utils.encode_range(range.s, { c: range.e.c, r: startRow + 1 });
    worksheet['!ref'] = XLSX.utils.encode_range(range.s, { c: range.e.c, r: startRow });
    XLSX.writeFile(workbook, filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    req.session.message = 'Account Successfully Created!';
    req.session.user = { username, email, phone, address };
    res.render('account', {
      user: { username, email, phone, address },
      message: req.session.message,
      generatedParagraph: null,
      prompt,
      script: '<script>sessionStorage.setItem("userLoggedIn", "true");</script>'
    });
  } catch (error) {
    console.error("Error saving data to Excel file:", error);
    res.status(500).send('An error occurred while registering your account. Please try again.');
  }
});

// Middleware to ensure user is authenticated and manage redirection
function ensureAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/Home_Page.html');
}


// Login Route
app.post('/submit', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password are required.');
  }
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const accounts = XLSX.utils.sheet_to_json(sheet);
  const user = accounts.find(account => account.username === username && account.password === password);
  if (!user) {
    console.log('Invalid username.');
    return res.status(401).send('Invalid username or password.');
  }
  req.session.user = user;
  req.session.message = 'Successfully Logged In!';
  res.redirect('/account');
});

// Account Route
app.get('/account', ensureAuthenticated, (req, res) => {
  const message = req.session.message;
  req.session.message = null;
  res.render('account', {
    user: req.session.user,
    message,
    generatedParagraph: null,
    prompt: ''
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('An error occurred during logout.');
    }
    res.redirect('/Home_Page.html?logout=success');
  });
});

/*app.post('/generate', async (req, res) => {
  const { prompt, username, email, phone, streetaddress, suburb, state, postcode, country } = req.body;
  const generatedParagraph = await generateParagraph(prompt);
  const user = {
    username,
    email,
    phone,
    address: `${streetaddress}, ${suburb}, ${state}, ${postcode}, ${country}`
  };
  req.session.message = 'Paragraph successfully generated!';
  res.render('account', {
    user,
    message: req.session.message,
    generatedParagraph,
    prompt
  });
});*/

app.post('/clear-message', (req, res) => {
  req.session.message = null;
  res.sendStatus(200);
});

app.get('/settings', ensureAuthenticated, (req, res) => {
  res.render('settings', { user: req.session.user });
});

app.post('/update-settings', ensureAuthenticated, (req, res) => {
  const { username, email,phone, streetaddress, suburb, state, postcode, country,password } = req.body;

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const accounts = XLSX.utils.sheet_to_json(sheet);
  const userIndex = accounts.findIndex(account => account.username === req.session.user.username);
  console.log('Incoming Data:', req.body);
  console.log('Before Update:', accounts[userIndex]);
  if (userIndex !== -1) {
    accounts[userIndex] = {
      ...accounts[userIndex],
      username,
      email,
      phone,
      address: `${streetaddress}, ${suburb}, ${state}, ${postcode}, ${country}`,
      password
    };

     // Define the column order explicitly
     const columnOrder = ['username', 'email', 'phone', 'address', 'password']; // Adjust fields as needed

     // Convert JSON to sheet while maintaining column order
     const newSheet = XLSX.utils.json_to_sheet(accounts, { header: columnOrder });
 
     // Update the sheet in the workbook
     workbook.Sheets[workbook.SheetNames[0]] = newSheet;
     XLSX.writeFile(workbook, filePath);
     console.log(XLSX.utils.sheet_to_json(newSheet, { header: 1 }));

 
     // Update the session data and send success message
     req.session.user = accounts[userIndex];
     req.session.message = 'Settings updated successfully!';
  }

  res.redirect('/account');
});

app.post('/chat', async (req, res) => {
  
  const message = (req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ reply: 'Please type a message.' });
  }

  if (!req.session.chatHistory) req.session.chatHistory = [];

  try {
    const chat = model.startChat({ history: req.session.chatHistory });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    req.session.chatHistory.push(
      { role: 'user', parts: [{ text: message }] },
      { role: 'model', parts: [{ text: reply }] }
    );
    req.session.chatHistory = req.session.chatHistory.slice(-20);

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ reply: 'Sorry, something went wrong. Please try again.' });
  }
});

app.post('/chat/reset', (req, res) => {
  req.session.chatHistory = [];
  res.sendStatus(200);
});

/*app.post('/chat-image', async (req, res) => {
  const message = (req.body.message || '').trim() || 'Describe this image.';
  const image = req.body.image || '';

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(image);
  if (!match) {
    return res.status(400).json({ reply: 'Please choose a valid image (JPG, PNG, or WebP).' });
  }

  try {
    const result = await model.generateContent([
      { inlineData: { mimeType: match[1], data: match[2] } },
      message
    ]);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error('Image chat error:', err);
    res.status(500).json({ reply: 'Sorry, the image could not be analysed. Please try again.' });
  }
});*/

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

