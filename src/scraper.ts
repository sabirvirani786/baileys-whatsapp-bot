import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { env } from './config.js';
import type { Category, Product, ProductSet, HadeeyaProduct } from './types.js';

const KHARCHIFY_BASE = 'https://kharchify.in/api/public/v1';
const HADEEYA_API = 'https://hadeeya.in/wp-json/wp/v2';
const HADEEYA_MARKUP = 0.20;

const headers = { Authorization: `Bearer ${env.KHARCHIFY_API_KEY}` };

export async function fetchKharchifyCategories(): Promise<Category[]> {
  try {
    const { data } = await axios.get(`${KHARCHIFY_BASE}/categories`, { headers });
    return (data.data || []).map((c: any) => ({ name: c.name, source: 'kharchify', sourceId: c.id }));
  } catch (err) {
    console.error('[scraper] Kharchify categories fetch failed');
    return [];
  }
}

export async function fetchKharchifyProducts(search?: string, limit = 30): Promise<Product[]> {
  try {
    const params = { page: 1, limit, stockStatus: 'in', search };
    const { data } = await axios.get(`${KHARCHIFY_BASE}/products`, { headers, params });
    return (data.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      price: p.sell_price || p.mrp || p.price || 0,
      mrp: p.mrp || 0,
      stock: p.stock || 0,
      colour: p.colour,
      metal: p.metal,
      height: cmToInch(p.height),
      width: cmToInch(p.width),
      description: (p.description || '').replace(/<[^>]*>/g, '').trim(),
      image: p.image_url || p.image || (p.product_images?.[0]?.image_url),
      category: p.category?.name || 'Category',
      source: 'kharchify',
    }));
  } catch (err) {
    console.error('[scraper] Kharchify products fetch failed');
    return [];
  }
}

export async function fetchKharchifySets(): Promise<ProductSet[]> {
  try {
    const { data } = await axios.get(`${KHARCHIFY_BASE}/sets`, { headers });
    return data.data || [];
  } catch {
    return [];
  }
}

export async function fetchHadeeyaCategories(): Promise<Category[]> {
  try {
    const { data } = await axios.get(`${HADEEYA_API}/product_cat`, {
      params: { per_page: 50, hide_empty: true, _fields: 'id,name,count' },
    });
    return (data || [])
      .filter((c: any) => c.name !== 'Uncategorized' && c.count > 0)
      .map((c: any) => ({ name: c.name, source: 'hadeeya', sourceId: c.id }));
  } catch {
    return [];
  }
}

const HADEEYA_STATIC_CATEGORIES = [
  { name: "Velvet Banner", id: 32 },
  { name: "Cotton Banners", id: 33 },
  { name: "roll pati", id: 85 },
  { name: "AZA CURTAINS", id: 123 },
  { name: "JHALAR", id: 103 },
  { name: "METAL ART", id: 19 },
  { name: "WALL MURALS", id: 16 },
  { name: "Tasbeeh", id: 68 },
  { name: "SYRIAN TUGRA", id: 76 },
];

export async function fetchHadeeyaProducts(keyword: string | number, limit = 5): Promise<Product[]> {
  try {
    const params: any = { per_page: limit, _fields: 'id,title,link,featured_media,excerpt' };

    if (!isNaN(Number(keyword))) {
      params.product_cat = Number(keyword);
    } else {
      params.search = String(keyword);
    }

    const { data } = await axios.get(`${HADEEYA_API}/product`, { params });
    const products: Product[] = [];

    // Process in batches of 10 to avoid rate limiting while speeding up
    for (let i = 0; i < data.length; i += 10) {
      const batch = data.slice(i, i + 10);
      const batchResults = await Promise.all(batch.map(async (p: any) => {
        let image = null;
        if (p.featured_media) {
          try {
            const { data: media } = await axios.get(`${HADEEYA_API}/media/${p.featured_media}`);
            image = media.source_url;
          } catch { /* ignore */ }
        }

        const details = await scrapeHadeeyaProductPage(p.link);

        // Skip out of stock items
        if (details.stock && details.stock.toLowerCase().includes('out of stock')) return null;

        return {
          id: p.id,
          name: cheerio.load(p.title?.rendered || 'Product').text().replace(/\*/g, '').trim(),
          price: details.price || 0,
          description: details.formattedDetails,
          image,
          link: p.link,
          source: 'hadeeya',
        };
      }));

      for (const res of batchResults) {
        if (res) products.push(res);
      }
    }

    return products;
  } catch {
    return [];
  }
}

export async function getCombinedCategories(): Promise<Category[]> {
  const cats = await fetchKharchifyCategories();

  for (const cat of HADEEYA_STATIC_CATEGORIES) {
    cats.push({ name: cat.name, source: 'hadeeya', sourceId: String(cat.id) });
  }

  return cats;
}

export async function scrapeHadeeyaProductPage(url: string): Promise<{ price: number | null, stock: string, sku: string, formattedDetails: string }> {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    let originalPrice = $('del .woocommerce-Price-amount').first().text() || '';
    const priceText = $('ins .woocommerce-Price-amount').first().text() || $('.price .woocommerce-Price-amount').first().text();
    const priceRaw = parseFloat(priceText.replace(/[^\d.]/g, ''));
    const price = !isNaN(priceRaw) ? Math.round(priceRaw * (1 + HADEEYA_MARKUP)) : null;

    let stock = $('.stock').text().trim() || $('.in-stock').text().trim() || 'In Stock';
    let sku = '';
    const script = $('script[type="application/ld+json"]').html();
    if (script) {
      try {
        const json = JSON.parse(script);
        const graph = json['@graph'] || [];
        const prod = graph.find((i: any) => i['@type'] === 'Product') || (json['@type'] === 'Product' ? json : null);
        if (prod) sku = prod.sku || '';
      } catch { /* ignore */ }
    }

    const infoLines: string[] = [];
    $('.product-short-description ul li, .woocommerce-product-details__short-description ul li').each((_, el) => {
      let text = $(el).text().trim().replace(/\*/g, '');
      if (text.toUpperCase().includes('KINDLY NOTE')) {
        text = `🚨 *${text}* 🚨`;
      }
      infoLines.push(text);
    });
    if (infoLines.length === 0) {
      let pText = $('.product-short-description p, .woocommerce-product-details__short-description p').text().trim().replace(/\*/g, '');
      if (pText.toUpperCase().includes('KINDLY NOTE')) {
        pText = `🚨 *${pText}* 🚨`;
      }
      if (pText) infoLines.push(pText);
    }

    let formattedDetails = infoLines.join('\n');
    if (formattedDetails) formattedDetails += '\n\n';
    if (stock) formattedDetails += `Availability: ${stock}\n\n`;

    return { price, stock, sku, formattedDetails };
  } catch {
    return { price: null, stock: '', sku: '', formattedDetails: '' };
  }
}

export async function downloadImage(url: string, filename: string): Promise<string | null> {
  const dir = path.resolve('poster_images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  if (['mp4', 'mov', 'avi'].includes(ext)) return null;
  const p = path.join(dir, `${filename}.${ext}`);
  if (fs.existsSync(p)) return p;

  try {
    const { data } = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(p);
    data.pipe(writer);
    return new Promise((resolve) => {
      writer.on('finish', () => resolve(p));
      writer.on('error', () => resolve(null));
    });
  } catch {
    return null;
  }
}

function cmToInch(cm?: number): string {
  return cm && cm > 0 ? `${(cm / 2.54).toFixed(1)}inch` : '';
}

export function formatProduct(p: Product): string {
  if (p.source === 'hadeeya') {
    const lines = [`📌 *${p.name.replace(/&#038;/g, '&')}*`];
    if (p.description) lines.push(`\n${p.description}`);
    lines.push(`\n💰 Final Price: ₹${p.price}`);
    return lines.join('\n');
  }

  const lines = [`📌 *${p.name}*`, `💰 Price: ₹${p.price}`];
  if (p.category) lines.push(`🏷️ ${p.category}`);
  if (p.colour && p.colour !== 'N/A') lines.push(`🎨 Colour: ${p.colour}`);
  if (p.metal && p.metal !== 'N/A') lines.push(`🔩 Metal: ${p.metal}`);
  const dims = [p.height, p.width].filter(Boolean);
  if (dims.length) lines.push(`📏 ${dims.join(' | ')}`);
  if (p.description) lines.push(`📝 ${p.description.substring(0, 150)}...`);
  return lines.join('\n');
}

export function formatSet(s: ProductSet): string {
  const lines = [`🎁 *FEATURED SET: ${s.name}*`];
  if (s.description) lines.push(`📝 ${s.description}`);
  let total = 0;
  if (s.items?.length) {
    lines.push(`\n📦 Includes:`);
    for (const item of s.items) {
      const price = item.unit_price || item.sell_price || 0;
      const qty = item.quantity || 1;
      total += price * qty;
      lines.push(`  • ${item.product_name || item.name} (₹${price} x ${qty})`);
    }
    lines.push(`\n💰 Total Value: ₹${total}`);
  }
  const setPrice = s.set_price || s.sell_price || s.mrp || s.price || 0;
  lines.push(`🏷️ Set Hadia: ₹${setPrice}`);
  if (total > setPrice) lines.push(`🎉 You Save: ₹${total - setPrice}`);
  return lines.join('\n');
}
