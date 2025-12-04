/**
 * 全施設の利用可能時間帯調査スクリプト
 * 
 * 各施設の週間カレンダーHTMLを取得し、実際に表示される時間帯コードを抽出
 */

import { 
  loginToShinagawa, 
  loginToMinato,
  checkShinagawaWeeklyAvailability,
  checkMinatoWeeklyAvailability,
  SHINAGAWA_TIMESLOT_MAP,
  MINATO_TIMESLOT_MAP
} from './src/scraper';

interface FacilityTimeslotInfo {
  facilityId: string;
  facilityName: string;
  site: 'shinagawa' | 'minato';
  detectedTimeSlots: string[];
  timeCodes: number[];
}

// 品川区のテニスコート一覧
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

// 港区のテニスコート一覧（代表的な施設）
const MINATO_FACILITIES = [
  { id: '1000310', name: '芝公園多目的運動場 テニスコート' },
  { id: '1000320', name: '青山運動場 テニスコート' },
  { id: '1000330', name: '高輪森の公園 テニスコート' },
];

async function investigateShinagawaTimeslots(): Promise<FacilityTimeslotInfo[]> {
  console.log('🔍 品川区施設の時間帯調査開始...\n');
  
  const userId = process.env.SHINAGAWA_USER_ID;
  const password = process.env.SHINAGAWA_PASSWORD;
  
  if (!userId || !password) {
    console.error('❌ 環境変数 SHINAGAWA_USER_ID, SHINAGAWA_PASSWORD が設定されていません');
    return [];
  }
  
  // ログイン
  console.log('🔐 品川区にログイン中...');
  const sessionId = await loginToShinagawa(userId, password);
  if (!sessionId) {
    console.error('❌ ログイン失敗');
    return [];
  }
  console.log('✅ ログイン成功\n');
  
  const results: FacilityTimeslotInfo[] = [];
  const today = new Date();
  const weekStartDate = today.toISOString().split('T')[0];
  
  for (const facility of SHINAGAWA_FACILITIES) {
    console.log(`📊 ${facility.name} (${facility.id}) を調査中...`);
    
    try {
      const weeklyData = await checkShinagawaWeeklyAvailability(
        facility.id,
        weekStartDate,
        { username: userId, password },
        sessionId
      );
      
      // 検出された時間帯を抽出
      const detectedTimeCodes = new Set<number>();
      const detectedTimeSlots = new Set<string>();
      
      for (const [key, status] of weeklyData.availability.entries()) {
        // key: "2025-12-04_09:00-11:00"
        const timeSlot = key.split('_')[1]; // "09:00-11:00"
        const timeStart = timeSlot.split('-')[0]; // "09:00"
        
        detectedTimeSlots.add(timeStart);
        
        // 時間帯コードを逆引き
        for (const [code, time] of Object.entries(SHINAGAWA_TIMESLOT_MAP)) {
          if (time === timeStart) {
            detectedTimeCodes.add(parseInt(code));
          }
        }
      }
      
      const timeSlots = Array.from(detectedTimeSlots).sort();
      const timeCodes = Array.from(detectedTimeCodes).sort((a, b) => a - b);
      
      results.push({
        facilityId: facility.id,
        facilityName: facility.name,
        site: 'shinagawa',
        detectedTimeSlots: timeSlots,
        timeCodes: timeCodes,
      });
      
      console.log(`  ✅ 検出時間帯: ${timeSlots.join(', ')}`);
      console.log(`  📝 時間帯コード: ${timeCodes.join(', ')}\n`);
      
      // レート制限回避のため少し待機
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error: any) {
      console.error(`  ❌ エラー: ${error.message}\n`);
    }
  }
  
  return results;
}

async function investigateMinatoTimeslots(): Promise<FacilityTimeslotInfo[]> {
  console.log('\n🔍 港区施設の時間帯調査開始...\n');
  
  const userId = process.env.MINATO_USER_ID;
  const password = process.env.MINATO_PASSWORD;
  
  if (!userId || !password) {
    console.log('⚠️ 環境変数 MINATO_USER_ID, MINATO_PASSWORD が設定されていません（スキップ）');
    return [];
  }
  
  // ログイン
  console.log('🔐 港区にログイン中...');
  const sessionId = await loginToMinato(userId, password);
  if (!sessionId) {
    console.error('❌ ログイン失敗');
    return [];
  }
  console.log('✅ ログイン成功\n');
  
  const results: FacilityTimeslotInfo[] = [];
  const today = new Date();
  const weekStartDate = today.toISOString().split('T')[0];
  
  for (const facility of MINATO_FACILITIES) {
    console.log(`📊 ${facility.name} (${facility.id}) を調査中...`);
    
    try {
      const weeklyData = await checkMinatoWeeklyAvailability(
        facility.id,
        weekStartDate,
        { username: userId, password },
        sessionId
      );
      
      // 検出された時間帯を抽出
      const detectedTimeCodes = new Set<number>();
      const detectedTimeSlots = new Set<string>();
      
      for (const [key, status] of weeklyData.availability.entries()) {
        const timeSlot = key.split('_')[1]; // "08:00"
        detectedTimeSlots.add(timeSlot);
        
        // 時間帯コードを逆引き
        for (const [code, time] of Object.entries(MINATO_TIMESLOT_MAP)) {
          if (time === timeSlot) {
            detectedTimeCodes.add(parseInt(code));
          }
        }
      }
      
      const timeSlots = Array.from(detectedTimeSlots).sort();
      const timeCodes = Array.from(detectedTimeCodes).sort((a, b) => a - b);
      
      results.push({
        facilityId: facility.id,
        facilityName: facility.name,
        site: 'minato',
        detectedTimeSlots: timeSlots,
        timeCodes: timeCodes,
      });
      
      console.log(`  ✅ 検出時間帯: ${timeSlots.join(', ')}`);
      console.log(`  📝 時間帯コード: ${timeCodes.join(', ')}\n`);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error: any) {
      console.error(`  ❌ エラー: ${error.message}\n`);
    }
  }
  
  return results;
}

function generateSummaryReport(results: FacilityTimeslotInfo[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📋 調査結果サマリー');
  console.log('='.repeat(80) + '\n');
  
  // 自治体ごとにグループ化
  const shinagawaResults = results.filter(r => r.site === 'shinagawa');
  const minatoResults = results.filter(r => r.site === 'minato');
  
  // 品川区の分析
  if (shinagawaResults.length > 0) {
    console.log('🏢 品川区 (調査施設数: ' + shinagawaResults.length + ')');
    console.log('-'.repeat(80));
    
    // 時間帯パターンを集計
    const timeslotPatterns = new Map<string, string[]>();
    for (const result of shinagawaResults) {
      const pattern = result.detectedTimeSlots.join(',');
      if (!timeslotPatterns.has(pattern)) {
        timeslotPatterns.set(pattern, []);
      }
      timeslotPatterns.get(pattern)!.push(result.facilityName);
    }
    
    console.log(`\n時間帯パターン数: ${timeslotPatterns.size}\n`);
    
    let patternNum = 1;
    for (const [pattern, facilities] of timeslotPatterns.entries()) {
      console.log(`パターン${patternNum}: [${pattern}]`);
      console.log(`  該当施設数: ${facilities.length}`);
      for (const name of facilities) {
        console.log(`    - ${name}`);
      }
      console.log('');
      patternNum++;
    }
    
    // 統一性チェック
    if (timeslotPatterns.size === 1) {
      console.log('✅ 品川区: 全施設で時間帯が統一されています');
    } else {
      console.log('⚠️ 品川区: 施設ごとに時間帯が異なります → 個別対応が必要');
    }
    console.log('\n');
  }
  
  // 港区の分析
  if (minatoResults.length > 0) {
    console.log('🏢 港区 (調査施設数: ' + minatoResults.length + ')');
    console.log('-'.repeat(80));
    
    const timeslotPatterns = new Map<string, string[]>();
    for (const result of minatoResults) {
      const pattern = result.detectedTimeSlots.join(',');
      if (!timeslotPatterns.has(pattern)) {
        timeslotPatterns.set(pattern, []);
      }
      timeslotPatterns.get(pattern)!.push(result.facilityName);
    }
    
    console.log(`\n時間帯パターン数: ${timeslotPatterns.size}\n`);
    
    let patternNum = 1;
    for (const [pattern, facilities] of timeslotPatterns.entries()) {
      console.log(`パターン${patternNum}: [${pattern}]`);
      console.log(`  該当施設数: ${facilities.length}`);
      for (const name of facilities) {
        console.log(`    - ${name}`);
      }
      console.log('');
      patternNum++;
    }
    
    if (timeslotPatterns.size === 1) {
      console.log('✅ 港区: 全施設で時間帯が統一されています');
    } else {
      console.log('⚠️ 港区: 施設ごとに時間帯が異なります → 個別対応が必要');
    }
    console.log('\n');
  }
  
  console.log('='.repeat(80));
  
  // TypeScript形式のデータ出力
  console.log('\n\n📄 実装用データ (TypeScript形式):');
  console.log('='.repeat(80));
  console.log('\nconst FACILITY_TIMESLOTS: Record<string, string[]> = {');
  for (const result of results) {
    console.log(`  '${result.facilityId}': [${result.detectedTimeSlots.map(t => `'${t}'`).join(', ')}], // ${result.facilityName}`);
  }
  console.log('};');
  console.log('\n');
}

async function main() {
  console.log('🎾 テニスコート予約システム - 時間帯調査ツール\n');
  console.log('開始時刻: ' + new Date().toLocaleString('ja-JP') + '\n');
  
  const allResults: FacilityTimeslotInfo[] = [];
  
  // 品川区の調査
  const shinagawaResults = await investigateShinagawaTimeslots();
  allResults.push(...shinagawaResults);
  
  // 港区の調査
  const minatoResults = await investigateMinatoTimeslots();
  allResults.push(...minatoResults);
  
  // サマリーレポート生成
  generateSummaryReport(allResults);
  
  console.log('完了時刻: ' + new Date().toLocaleString('ja-JP'));
}

main().catch(console.error);
