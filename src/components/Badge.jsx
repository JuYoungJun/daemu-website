const MAP = {
  '운영중':'done','활성':'done','NEW':'new','준비중':'pending',
  '대기':'pending','신규':'new','처리중':'pending','완료':'done',
  '답변완료':'done','접수':'new','출고완료':'done','비활성':'pending','일시중지':'pending'
};

export default function Badge({ status }) {
  const cls = MAP[status] || 'done';
  return <span className={`adm-badge adm-badge--${cls}`}>{status}</span>;
}
