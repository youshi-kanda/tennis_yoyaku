/**
 * JST Date Utilities
 * Cloudflare Workers run in UTC, so we need explicit JST conversion.
 */

export function getJSTDate(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date).replace(/\//g, '-');
}

export function getJSTTime(date: Date = new Date()): string {
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date);
}
