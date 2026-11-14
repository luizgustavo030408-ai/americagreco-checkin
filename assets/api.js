// Comunicação com o banco (Supabase RPC) + utilitários
window.API = (() => {
  const C = window.SPIN_CFG;
  async function rpc(fn, args = {}) {
    const r = await fetch(`${C.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: C.key, Authorization: `Bearer ${C.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    const txt = await r.text();
    let data; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) {
      const e = new Error((data && data.message) || 'Falha de conexão. Tente novamente.');
      e.code = data && data.code; throw e;
    }
    return data;
  }
  return { rpc };
})();

window.U = {
  TZ: 'America/Boa_Vista',
  hoje() { return new Intl.DateTimeFormat('en-CA', { timeZone: this.TZ }).format(new Date()); },
  addDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  dow(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); },
  semana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  semanaLonga: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
  meses: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  rotulo(iso) {
    const h = this.hoje();
    if (iso === h) return 'Hoje';
    if (iso === this.addDias(h, 1)) return 'Amanhã';
    return this.semana[this.dow(iso)];
  },
  dataBR(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}`; },
  dataLonga(iso) { const [y, m, d] = iso.split('-'); return `${this.semanaLonga[this.dow(iso)]}, ${+d} ${this.meses[+m - 1]}`; },
  so(v) { return (v || '').replace(/\D/g, ''); },
  maskCPF(v) {
    v = this.so(v).slice(0, 11);
    return v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  },
  cpfOk(c) {
    c = this.so(c);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === +c[9] && dv(10) === +c[10];
  },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
};
