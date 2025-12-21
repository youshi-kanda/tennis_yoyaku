/**
 * 全施設の利用可能時間帯を調査するスクリプト
 * 
 * 実行方法:
 * npx tsx investigate-facility-timeslots.ts
 */

import { 
  loginToShinagawa, 
  loginToMinato,
  checkShinagawaWeeklyAvailability,
  checkMinatoWeeklyAvailability,
  SHINAGAWA_TIMESLOT_MAP,
  MINATO_TIMESLOT_MAP
} from '../src/scraper';

interface FacilityTimeSlots {
  facilityId: string;
  facilityName: string;
  site: 'shinagawa' | 'minato';
  detectedTimeSlots: string[];
  timeCodes: number[];
}

// 品川区の全施設リスト
const SHINAGAWA_FACILITIES = [
  { id: '10400010', name: 'しながわ区民公園 庭球場Ａ' },
  { id: '10400020', name: 'しながわ区民公園 庭球場Ｂ' },
  { id: '10400030', name: 'しながわ区民公園 庭球場Ｃ' },
  { id: '10400040', name: 'しながわ区民公園 庭球場Ｄ' },
  { id: '10100010', name: 'しながわ中央公園 庭球場Ａ' },
  { id: '10100020', name: 'しながわ中央公園 庭球場Ｂ' },
  { id: '10200010', name: '東品川公園 庭球場Ａ' },
  { id: '10200020', name: '東品川公園 庭球場Ｂ' },
  { id: '10300010', name: '八潮北公園 庭球場Ａ' },
  { id: '10300020', name: '八潮北公園 庭球場Ｂ' },
  { id: '10300030', name: '八潮北公園 庭球場Ｃ' },
  { id: '10300040', name: '八潮北公園 庭球場Ｄ' },
  { id: '10300050', name: '八潮北公園 庭球場Ｅ' },
];

// 港区の主要施設リスト（実際のIDは要確認）
const MINATO_FACILITIES = [
  { id: '10010010', name: '港区施設1' },
  { id: '10010020', name: '港区施設2' },
  // 実際の施設IDを追加
];

/**
 * HTMLから実際に存在する時間帯コードを抽出
 */
function extractTimeSlotsFromHTML(html: string, site: 'shinagawa' | 'minato'): number[] {
  const timeCodes = new Set<number>();
  
  // セルのパターン: id="YYYYMMDD_XX" (XXが時間帯コード)
  const cellPattern = /<td[^>]*\sid="(\d{8})_(\d{2})"[^>]*>/gi;
  let match;
  
  while ((match = cellPattern.exec(html)) !== null) {
    const timeCode = parseInt(match[2], 10);
    timeCodes.add(timeCode);
  }
  
  return Array.from(timeCodes).sort((a, b) => a - b);
}

/**
 * 品川区の施設を調査
 */
async function investigateShinagawaFacility(
  facilityId: string, 
  facilityName: string,
  sessionId: string
): Promise<FacilityTimeSlots | null> {
  try {
    console.log(`\n🔍 調査中: ${facilityName} (${facilityId})`);
    
    // 今週の週間カレンダーを取得
    const today = new Date();
    const weekStartDate = today.toISOString().split('T')[0];
    
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    const searchParams = new URLSearchParams({
      'selectBldCd': facilityId.substring(0, 4),
      'selectInstCd': facilityId,
      'selectPpsClsCd': '31000000',
      'selectPpsCd': '31011700',
      'displayNo': 'prwrc2000',
      'search': '検索',
    });
    
    const response = await fetch(`${baseUrl}/rsvWPFrmInstWeekAction.do?${searchParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('shift-jis');
    const html = decoder.decode(buffer);
    
    // 時間帯コードを抽出
    const timeCodes = extractTimeSlotsFromHTML(html, 'shinagawa');
    const timeSlots = timeCodes.map(code => SHINAGAWA_TIMESLOT_MAP[code]).filter(Boolean);
    
    console.log(`  ✅ 検出された時間帯コード: ${timeCodes.join(', ')}`);
    console.log(`  ✅ 時間帯: ${timeSlots.join(', ')}`);
    
    return {
      facilityId,
      facilityName,
      site: 'shinagawa',
      detectedTimeSlots: timeSlots,
      timeCodes,
    };
  } catch (error: any) {
    console.error(`  ❌ エラー: ${error.message}`);
    return null;
  }
}

/**
 * 港区の施設を調査
 */
async function investigateMinatoFacility(
  facilityId: string, 
  facilityName: string,
  sessionId: string
): Promise<FacilityTimeSlots | null> {
  try {
    console.log(`\n🔍 調査中: ${facilityName} (${facilityId})`);
    
    const today = new Date();
    const weekStartDate = today.toISOString().split('T')[0];
    
    const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
    const searchParams = new URLSearchParams({
      'rsvWInstSrchVacantForm.instCd': facilityId,
      'rsvWInstSrchVacantForm.srchDate': weekStartDate.replace(/-/g, ''),
    });
    
    const response = await fetch(`${baseUrl}/rsvWInstSrchVacantAction.do?${searchParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    const html = await response.text();
    
    // 時間帯コードを抽出
    const timeCodes = extractTimeSlotsFromHTML(html, 'minato');
    const timeSlots = timeCodes.map(code => MINATO_TIMESLOT_MAP[code]).filter(Boolean);
    
    console.log(`  ✅ 検出された時間帯コード: ${timeCodes.join(', ')}`);
    console.log(`  ✅ 時間帯: ${timeSlots.join(', ')}`);
    
    return {
      facilityId,
      facilityName,
      site: 'minato',
      detectedTimeSlots: timeSlots,
      timeCodes,
    };
  } catch (error: any) {
    console.error(`  ❌ エラー: ${error.message}`);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('🎾 テニスコート施設 時間帯調査開始\n');
  console.log('=' .repeat(60));
  
  // 環境変数から認証情報を取得
  const shinagawaUserId = process.env.SHINAGAWA_USER_ID;
  const shinagawaPassword = process.env.SHINAGAWA_PASSWORD;
  const minatoUserId = process.env.MINATO_USER_ID;
  const minatoPassword = process.env.MINATO_PASSWORD;
  
  if (!shinagawaUserId || !shinagawaPassword) {
    console.error('❌ 品川区の認証情報が設定されていません');
    console.error('環境変数 SHINAGAWA_USER_ID, SHINAGAWA_PASSWORD を設定してください');
    return;
  }
  
  const results: FacilityTimeSlots[] = [];
  
  // 品川区の調査
  console.log('\n📍 品川区施設の調査');
  console.log('=' .repeat(60));
  
  const shinagawaSessionId = await loginToShinagawa(shinagawaUserId, shinagawaPassword);
  if (!shinagawaSessionId) {
    console.error('❌ 品川区ログイン失敗');
  } else {
    console.log('✅ 品川区ログイン成功\n');
    
    for (const facility of SHINAGAWA_FACILITIES) {
      const result = await investigateShinagawaFacility(
        facility.id,
        facility.name,
        shinagawaSessionId
      );
      if (result) {
        results.push(result);
      }
      
      // レート制限対策
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // 港区の調査（認証情報がある場合のみ）
  if (minatoUserId && minatoPassword) {
    console.log('\n\n📍 港区施設の調査');
    console.log('=' .repeat(60));
    
    const minatoSessionId = await loginToMinato(minatoUserId, minatoPassword);
    if (!minatoSessionId) {
      console.error('❌ 港区ログイン失敗');
    } else {
      console.log('✅ 港区ログイン成功\n');
      
      for (const facility of MINATO_FACILITIES) {
        const result = await investigateMinatoFacility(
          facility.id,
          facility.name,
          minatoSessionId
        );
        if (result) {
          results.push(result);
        }
        
        // レート制限対策
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } else {
    console.log('\n⚠️ 港区の認証情報が設定されていないため、港区の調査はスキップします');
  }
  
  // 結果サマリー
  console.log('\n\n📊 調査結果サマリー');
  console.log('=' .repeat(60));
  
  // 時間帯パターンをグループ化
  const patterns = new Map<string, FacilityTimeSlots[]>();
  
  for (const result of results) {
    const key = result.detectedTimeSlots.join(',');
    if (!patterns.has(key)) {
      patterns.set(key, []);
    }
    patterns.get(key)!.push(result);
  }
  
  console.log(`\n🔍 発見された時間帯パターン: ${patterns.size}種類\n`);
  
  let patternIndex = 1;
  for (const [pattern, facilities] of patterns) {
    console.log(`\nパターン${patternIndex}: [${pattern}]`);
    console.log(`施設数: ${facilities.length}`);
    console.log('施設一覧:');
    for (const facility of facilities) {
      console.log(`  - ${facility.facilityName} (${facility.facilityId})`);
    }
    patternIndex++;
  }
  
  // 結論
  console.log('\n\n📝 結論');
  console.log('=' .repeat(60));
  
  if (patterns.size === 1) {
    console.log('✅ 全施設で同じ時間帯が使用されています');
    console.log('   → 現在の実装で問題ありません');
  } else {
    console.log('⚠️ 施設によって利用可能時間帯が異なります');
    console.log('   → 施設別の時間帯管理が必要です');
  }
  
  // JSON出力
  console.log('\n\n💾 JSON形式の結果 (実装用)');
  console.log('=' .repeat(60));
  
  const facilityTimeSlotsMap: Record<string, string[]> = {};
  for (const result of results) {
    facilityTimeSlotsMap[result.facilityId] = result.detectedTimeSlots;
  }
  
  console.log(JSON.stringify(facilityTimeSlotsMap, null, 2));
}

// 実行
main().catch(console.error);
