// 予約可能期間の動的取得

export interface ReservationPeriodInfo {
  maxDaysAhead: number;
  source: 'html_extraction' | 'calendar_detection' | 'fallback';
  detectedAt: number;
  rawInfo?: string;
}

/**
 * HTMLから予約可能期間を抽出
 */
async function extractFromHTML(
  site: 'shinagawa' | 'minato',
  sessionId: string
): Promise<ReservationPeriodInfo | null> {
  try {
    const baseUrl = site === 'shinagawa' 
      ? 'https://www.cm9.eprs.jp/shinagawa/web'
      : 'https://web101.rsv.ws-scs.jp/web';
    
    console.log(`[Period] Attempting HTML extraction for ${site}`);
    
    // 複数のページを試す
    const pages = [
      'rsvWOpeHelpAction.do',
      'rsvWOpeHomeAction.do',
      'rsvWTransUserGuideAction.do',
    ];
    
    for (const page of pages) {
      try {
        const response = await fetch(`${baseUrl}/${page}`, {
          headers: {
            'Cookie': `JSESSIONID=${sessionId}`,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });
        
        if (response.status !== 200) continue;
        
        const html = await response.text();
        
        // 様々なパターンで検索
        const patterns = [
          /(\d+)ヶ月先まで/,
          /(\d+)か月先まで/,
          /(\d+)ヶ月前から/,
          /(\d+)か月前から/,
          /(\d+)日先まで/,
          /(\d+)日前から/,
          /予約可能期間[：:]\s*(\d+)日/,
          /予約可能期間[：:]\s*(\d+)ヶ月/,
          /(\d+)ヶ月以内/,
        ];
        
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) {
            const value = parseInt(match[1]);
            const isMonths = match[0].includes('ヶ月') || match[0].includes('か月');
            const days = isMonths ? value * 30 : value;
            
            console.log(`[Period] Found in ${page}: "${match[0]}" → ${days} days`);
            
            return {
              maxDaysAhead: days,
              source: 'html_extraction',
              detectedAt: Date.now(),
              rawInfo: match[0],
            };
          }
        }
      } catch (error) {
        console.error(`[Period] Error checking ${page}:`, error);
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Period] HTML extraction failed:', error);
    return null;
  }
}

/**
 * カレンダーUIから最大予約日を検出
 */
async function detectFromCalendar(
  site: 'shinagawa' | 'minato',
  sessionId: string
): Promise<ReservationPeriodInfo | null> {
  try {
    const baseUrl = site === 'shinagawa' 
      ? 'https://www.cm9.eprs.jp/shinagawa/web'
      : 'https://web101.rsv.ws-scs.jp/web';
    
    console.log(`[Period] Attempting calendar detection for ${site}`);
    
    const response = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    
    if (response.status !== 200) {
      console.log(`[Period] Calendar page returned status ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // 日付フィールドのmax属性を探す
    const patterns = [
      /max=["'](\d{4}-\d{2}-\d{2})["']/,
      /maxDate:\s*["'](\d{4}-\d{2}-\d{2})["']/,
      /data-max-date=["'](\d{4}-\d{2}-\d{2})["']/,
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        const maxDate = match[1];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const maxDateObj = new Date(maxDate);
        const diffTime = maxDateObj.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 0 && diffDays < 400) { // 妥当な範囲
          console.log(`[Period] Detected from calendar: ${maxDate} (${diffDays} days ahead)`);
          
          return {
            maxDaysAhead: diffDays,
            source: 'calendar_detection',
            detectedAt: Date.now(),
            rawInfo: `max-date: ${maxDate}`,
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Period] Calendar detection failed:', error);
    return null;
  }
}

/**
 * フォールバック: デフォルト値を使用
 */
function getFallbackPeriod(site: 'shinagawa' | 'minato'): ReservationPeriodInfo {
  const defaultDays = 90; // 3ヶ月（保守的な値）
  
  console.log(`[Period] Using fallback default for ${site}: ${defaultDays} days`);
  
  return {
    maxDaysAhead: defaultDays,
    source: 'fallback',
    detectedAt: Date.now(),
    rawInfo: 'Default value (90 days)',
  };
}

/**
 * ハイブリッドアプローチ: 複数手段で予約可能期間を取得
 */
export async function getOrDetectReservationPeriod(
  site: 'shinagawa' | 'minato',
  sessionId: string,
  kv: KVNamespace
): Promise<ReservationPeriodInfo> {
  const cacheKey = `reservation_period:${site}`;
  
  // 1. KVキャッシュから取得（24時間TTL）
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const info: ReservationPeriodInfo = JSON.parse(cached);
      const age = Date.now() - info.detectedAt;
      const ageHours = age / (1000 * 60 * 60);
      
      console.log(`[Period] Using cached period for ${site}: ${info.maxDaysAhead} days (${info.source}, ${ageHours.toFixed(1)}h old)`);
      return info;
    }
  } catch (error) {
    console.error('[Period] Cache read error:', error);
  }
  
  console.log(`[Period] No cache found for ${site}, detecting...`);
  
  // 2. HTMLから動的取得を試みる
  const htmlResult = await extractFromHTML(site, sessionId);
  if (htmlResult) {
    console.log(`[Period] ✅ Successfully extracted from HTML: ${htmlResult.maxDaysAhead} days`);
    
    // キャッシュに保存
    try {
      await kv.put(cacheKey, JSON.stringify(htmlResult), {
        expirationTtl: 86400, // 24時間
      });
    } catch (error) {
      console.error('[Period] Cache write error:', error);
    }
    
    return htmlResult;
  }
  
  // 3. カレンダーUIから判定
  const calendarResult = await detectFromCalendar(site, sessionId);
  if (calendarResult) {
    console.log(`[Period] ✅ Successfully detected from calendar: ${calendarResult.maxDaysAhead} days`);
    
    // キャッシュに保存
    try {
      await kv.put(cacheKey, JSON.stringify(calendarResult), {
        expirationTtl: 86400,
      });
    } catch (error) {
      console.error('[Period] Cache write error:', error);
    }
    
    return calendarResult;
  }
  
  // 4. フォールバック: デフォルト値を使用
  const fallbackResult = getFallbackPeriod(site);
  console.log(`[Period] ⚠️ Using fallback: ${fallbackResult.maxDaysAhead} days`);
  
  // フォールバックも一応キャッシュ（短時間）
  try {
    await kv.put(cacheKey, JSON.stringify(fallbackResult), {
      expirationTtl: 3600, // 1時間（短め）
    });
  } catch (error) {
    console.error('[Period] Cache write error:', error);
  }
  
  return fallbackResult;
}
