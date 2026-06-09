export interface Product {
  id?: string | number;
  name: string;
  price: number;
  mrp?: number;
  stock?: number;
  colour?: string;
  metal?: string;
  height?: string;
  width?: string;
  description?: string;
  image?: string | null;
  category?: string;
  source?: string;
  link?: string;
}

export interface Category {
  id?: string | number;
  name: string;
  source: 'kharchify' | 'hadeeya';
  sourceId?: string | number;
}

export interface SetItem {
  product_name?: string;
  name?: string;
  unit_price?: number;
  sell_price?: number;
  quantity?: number;
}

export interface ProductSet {
  id?: string | number;
  name: string;
  description?: string;
  set_price?: number;
  sell_price?: number;
  mrp?: number;
  price?: number;
  items?: SetItem[];
  product_images?: Array<{ image_url: string }>;
  image_url?: string;
}

export interface UserState {
  stage: 'categories' | 'products';
  cats?: Category[];
  selected?: Category;
  products?: Product[];
  categoriesLastSent?: number;
}

export interface DailyPostState {
  product_page: number;
  product_index: number;
  set_index: number;
  hadeeya_index?: number;
}

export interface BotConfig {
  bot: {
    autoReply: boolean;
    replyOnlyInPrivateChats: boolean;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    typingIndicator: boolean;
    typingDelayPerCharMs: number;
    maxRepliesPerHour: number;
    maxGlobalMessagesPerHour: number;
  };
  webhook: {
    enabled: boolean;
    url: string;
    secret: string;
  };
  session: {
    active: string;
  };
}

export interface HadeeyaProduct {
  product_id: number;
  sku: string;
  name: string;
  category: string;
  price_original: number | null;
  price_adjusted: number | null;
  stock: string;
  image_url: string;
  product_url: string;
  scraped_at?: string;
}
