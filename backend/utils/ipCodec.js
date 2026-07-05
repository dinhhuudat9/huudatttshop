const crypto = require('crypto');

function encodeIpToUnlockCode(ip, machineId = '') {
    try {
        const parts = String(ip || '').split('.');
        if (parts.length !== 4) {
            return `MMO-V6-${crypto.createHash('md5').update(ip).digest('hex').slice(0, 12).toUpperCase()}`;
        }
        
        const bytes = parts.map(p => parseInt(p, 10) & 255);
        const xorKey = [0x78, 0x9A, 0xBC, 0xDE];
        const obfuscated = bytes.map((b, i) => b ^ xorKey[i]);
        
        const hex = obfuscated.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
        const sum = bytes.reduce((acc, b) => acc + b, 0) & 255;
        const checksumHex = (sum ^ 0xAA).toString(16).padStart(2, '0').toUpperCase();
        
        const part1 = hex.slice(0, 4);
        const part2 = hex.slice(4, 8);
        return `MMO-IP-${part1}-${part2}-${checksumHex}`;
    } catch (_) {
        return machineId || 'MMO-ERROR';
    }
}

function decodeIpFromUnlockCode(code) {
    try {
        const clean = String(code || '').trim().toUpperCase();
        if (!clean.startsWith('MMO-IP-')) {
            return null;
        }
        
        const parts = clean.split('-');
        if (parts.length !== 5) {
            return null;
        }
        
        const part1 = parts[2];
        const part2 = parts[3];
        const checksumHex = parts[4];
        
        const hex = part1 + part2;
        if (hex.length !== 8) {
            return null;
        }
        
        const obfuscated = [];
        for (let i = 0; i < 4; i++) {
            obfuscated.push(parseInt(hex.slice(i * 2, (i + 1) * 2), 16));
        }
        
        const xorKey = [0x78, 0x9A, 0xBC, 0xDE];
        const bytes = obfuscated.map((b, i) => b ^ xorKey[i]);
        
        const sum = bytes.reduce((acc, b) => acc + b, 0) & 255;
        const expectedChecksum = (sum ^ 0xAA).toString(16).padStart(2, '0').toUpperCase();
        
        if (checksumHex !== expectedChecksum) {
            return null;
        }
        
        return bytes.join('.');
    } catch (_) {
        return null;
    }
}

module.exports = {
    encodeIpToUnlockCode,
    decodeIpFromUnlockCode
};
