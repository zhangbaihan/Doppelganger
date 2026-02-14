# Doppelganger

Train your AI twin. A minimalist webapp where you create a **Bit** — your AI doppelganger — and train it through voice conversations.

## Prerequisites

- Node.js 18+
- A [Google Cloud OAuth 2.0 Client ID](https://console.cloud.google.com/apis/credentials) (type: Web application, add `http://localhost:5173` as an authorized JavaScript origin)
- An [OpenAI API key](https://platform.openai.com/api-keys)

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your credentials:

```
GOOGLE_CLIENT_ID=your_google_client_id
OPENAI_API_KEY=sk-...
JWT_SECRET=any_random_string
```

Then install and run:

```bash
npm install
npm run dev
```

### 2. Frontend

```bash
cd frontend
```

Create a `.env` file:

```
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_API_URL=http://localhost:3001
```

Then install and run:

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## How It Works

1. **Sign in** with Google
2. **Name your Bit** — this is your AI doppelganger
3. **Talk to your Bit** — hit Record, speak, then stop. Your speech is transcribed and your Bit responds via text
4. **Complete initial training** — cover all 15 guided topics to remove the "Untrained" status
5. **Keep training** — the more you talk, the better your Bit's confidence scores become across four trait domains
