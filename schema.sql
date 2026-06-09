-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- Creates all tables needed by the Islamic bot

-- 1. Seen IDs (deduplication)
CREATE TABLE IF NOT EXISTS seen_ids (
    id BIGSERIAL PRIMARY KEY,
    message_id TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seen_ids_message_id ON seen_ids(message_id);
CREATE INDEX IF NOT EXISTS idx_seen_ids_created_at ON seen_ids(created_at);

-- 2. Checkpoints (last processed message per chat)
CREATE TABLE IF NOT EXISTS checkpoints (
    chat_id TEXT PRIMARY KEY,
    last_reply_timestamp TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Carts (shopping cart items)
CREATE TABLE IF NOT EXISTS carts (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    quantity INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carts_chat_id ON carts(chat_id);

-- 4. Conversation history (AI context that survives restarts)
CREATE TABLE IF NOT EXISTS conversation_history (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversation_history_chat_id ON conversation_history(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at ON conversation_history(created_at);

-- 5. Hadeeya products (scraped from hadeeya.in)
CREATE TABLE IF NOT EXISTS hadeeya_products (
    id BIGSERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    sku TEXT,
    name TEXT NOT NULL,
    category TEXT,
    price_original NUMERIC,
    price_adjusted NUMERIC,
    stock TEXT,
    image_url TEXT,
    product_url TEXT,
    scraped_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hadeeya_products_product_id ON hadeeya_products(product_id);
CREATE INDEX IF NOT EXISTS idx_hadeeya_products_name ON hadeeya_products(name);
CREATE INDEX IF NOT EXISTS idx_hadeeya_products_category ON hadeeya_products(category);

-- 6. Baileys Authentication State
CREATE TABLE IF NOT EXISTS baileys_auth (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
