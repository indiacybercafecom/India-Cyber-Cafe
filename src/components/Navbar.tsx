import { UserProfile } from '../types';
import { IconRenderer } from './Icons';

interface NavbarProps {
  user: UserProfile | null;
  loading?: boolean;
  onLoginClick: () => void;
  onMenuClick: () => void;
  onLogoClick: () => void;
}

export function Navbar({ user, loading, onLoginClick, onMenuClick, onLogoClick }: NavbarProps) {
  return (
    <nav className="fixed top-0 w-full h-[60px] sm:h-[70px] glass flex justify-between items-center px-[5%] shadow-sm z-[1000]">
      <div className="flex items-center cursor-pointer transition-transform hover:scale-105" onClick={onLogoClick}>
        <img 
          src="https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png" 
          alt="India Cyber Cafe" 
          className="h-[40px] sm:h-[55px] w-auto object-contain"
        />
      </div>
      
      <div className="flex items-center gap-2 sm:gap-4">
        {loading ? (
          <div className="w-24 h-10 bg-slate-100 animate-pulse rounded-full" />
        ) : !user ? (
          <button 
            className="border-2 border-navy text-navy px-4 sm:px-6 py-1.5 sm:py-2 rounded-full text-sm sm:text-base font-semibold transition-all hover:bg-navy hover:text-white"
            onClick={onLoginClick}
          >
            Login
          </button>
        ) : (
          <div 
            className="cursor-pointer transition-transform hover:scale-110"
            onClick={onMenuClick}
          >
            <img 
              src={user.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
              alt={user.name}
              className="w-[35px] h-[35px] sm:w-[45px] sm:h-[45px] rounded-full border-2 border-primary"
            />
          </div>
        )}
      </div>
    </nav>
  );
}
