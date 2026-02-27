import { Link } from 'react-router-dom';
import { IconRenderer } from './Icons';

export function Footer() {
  return (
    <footer className="bg-linear-to-b from-navy to-black text-white pt-16 pb-8 px-[5%]">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
        {/* Brand Section */}
        <div className="space-y-6 col-span-1 md:col-span-1">
          <img 
            src="https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png" 
            alt="India Cyber Cafe" 
            className="h-14 brightness-0 invert"
          />
          <p className="text-slate-400 text-sm leading-relaxed">
            India's most trusted digital service portal. We help you with government applications, cyber services, and digital solutions with speed and transparency.
          </p>
          <div className="flex gap-4">
            <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-primary transition-all">
              <IconRenderer name="facebook" className="w-5 h-5" />
            </a>
            <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-primary transition-all">
              <IconRenderer name="twitter" className="w-5 h-5" />
            </a>
            <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-primary transition-all">
              <IconRenderer name="instagram" className="w-5 h-5" />
            </a>
          </div>
        </div>

        {/* Quick Links */}
        <div className="space-y-6">
          <h4 className="text-lg font-bold border-l-4 border-primary pl-3">Quick Links</h4>
          <ul className="space-y-3 text-slate-400 text-sm">
            <li><Link to="/" className="hover:text-primary transition-colors">Home</Link></li>
            <li><Link to="/services" className="hover:text-primary transition-colors">All Services</Link></li>
            <li><Link to="/track" className="hover:text-primary transition-colors">Track Application</Link></li>
            <li><Link to="/profile" className="hover:text-primary transition-colors">My Profile</Link></li>
          </ul>
        </div>

        {/* Legal & Support */}
        <div className="space-y-6">
          <h4 className="text-lg font-bold border-l-4 border-primary pl-3">Legal & Support</h4>
          <ul className="space-y-3 text-slate-400 text-sm">
            <li><Link to="/legal/terms" className="hover:text-primary transition-colors">Terms & Conditions</Link></li>
            <li><Link to="/legal/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
            <li><Link to="/legal/licenses" className="hover:text-primary transition-colors">Policies & Licenses</Link></li>
            <li><Link to="/contact" className="hover:text-primary transition-colors">Help Center</Link></li>
          </ul>
        </div>

        {/* Contact Info */}
        <div className="space-y-6">
          <h4 className="text-lg font-bold border-l-4 border-primary pl-3">Contact Us</h4>
          <ul className="space-y-4 text-slate-400 text-sm">
            <li className="flex items-start gap-3">
              <IconRenderer name="envelope" className="w-5 h-5 text-primary shrink-0" />
              <span>icc@indiacybercafe.com</span>
            </li>
            <li className="flex items-start gap-3">
              <IconRenderer name="phone" className="w-5 h-5 text-primary shrink-0" />
              <span>+91 9203251821</span>
            </li>
            <li className="flex items-start gap-3">
              <IconRenderer name="location-dot" className="w-5 h-5 text-primary shrink-0" />
              <span>Jobgarh, Singrauli Madhya Pradesh 486886</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto pt-8 border-t border-white/10 text-center">
        <p className="text-slate-500 text-xs">
          © {new Date().getFullYear()} India Cyber Cafe. All rights reserved. Designed for speed and security.
        </p>
      </div>
    </footer>
  );
}
