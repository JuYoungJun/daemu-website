import { Link } from 'react-router-dom';
import { useFadeUp } from '../hooks/useFadeUp.js';

export default function Footer() {
  useFadeUp([]);
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer fade-up">
      <div className="wide footer-wrap">
        <div className="footer-main">
          <div className="footer-brand">
            <p className="footer-eyebrow">BAKERY &amp; CAFE BUSINESS PARTNER</p>
            <h2 className="footer-heading serif">Daemu</h2>
            <p className="footer-desc">
              브랜드 전략부터 메뉴 개발, 공간 기획, 운영 구조까지<br />
              대무는 카페 비즈니스의 실행을 함께 설계합니다.
            </p>
          </div>

          <div className="footer-links">
            <div className="footer-group">
              <h3>Menu</h3>
              <ul>
                <li><Link to="/service">SERVICE</Link></li>
                <li><Link to="/about">ABOUT US</Link></li>
                <li><Link to="/team">TEAM</Link></li>
                <li><Link to="/process">PROCESS</Link></li>
                <li><Link to="/work">WORK</Link></li>
                <li><Link to="/partners">PARTNERS</Link></li>
                <li><Link to="/contact">CONTACT</Link></li>
              </ul>
            </div>

            <div className="footer-group">
              <h3>Contact</h3>
              <ul>
                <li><a href="mailto:daemu_office@naver.com">daemu_office@naver.com</a></li>
                <li><a href="tel:0613351239">061-335-1239</a></li>
                <li>MON - FRI / 09:00 - 18:00</li>
                <li>Naju, Korea</li>
              </ul>
            </div>

            <div className="footer-group">
              <h3>Project</h3>
              <p>
                새로운 카페 창업, 리브랜딩, 메뉴 개발,<br />
                공간 기획이 필요하시면<br />
                편하게 문의해주세요.
              </p>
              <Link to="/contact" className="footer-link-btn">문의하기</Link>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© <span>{year}</span> DAEMU. All Rights Reserved.</p>
          <div className="footer-bottom-links">
            <Link to="/privacy">개인정보처리방침</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
