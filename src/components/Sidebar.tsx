import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { IconRenderer } from './Icons';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile | null;
  onNavigate: (page: string) => void;
  onLogout: () => void;
}

export function Sidebar({ isOpen, onClose, user, onNavigate, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'home', label: 'Home', icon: 'house' },
    { id: 'services', label: 'Services', icon: 'layer-group' },
    { id: 'price-list', label: 'Price List', icon: 'tag' },
    { id: 'store', label: 'Store', icon: 'shopping-bag' },
    { id: 'track', label: 'My Applications', icon: 'list-check' },
    { id: 'profile', label: 'Edit Profile', icon: 'user-pen' },
  ];

  if (user?.role === 'admin') {
    menuItems.push({ id: 'admin', label: 'Admin Panel', icon: 'shield-halved' });
  }
  if (user?.role === 'operator') {
    menuItems.push({ id: 'operator', label: 'Operator Panel', icon: 'desktop' });
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[1500]"
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ x: 300 }}
        animate={{ x: isOpen ? 0 : 300 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed top-0 right-0 w-full max-w-[280px] h-full bg-white z-[2000] shadow-2xl flex flex-col overflow-y-auto"
      >
        <div className="p-6 bg-linear-to-br from-navy to-navy-light text-white relative flex items-center gap-3 shadow-lg">
          <img 
            src={user?.avatar || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
            className="w-[48px] h-[48px] rounded-full border-2 border-white/50 shadow-md object-cover shrink-0"
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 min-w-0 pr-6">
            <h4 className="font-bold text-base leading-tight truncate flex items-center gap-1.5">
              Hi, {user?.name ? user.name.split(' ')[0] : 'Guest'}
            </h4>
            <span className="inline-block px-2 py-0.5 bg-white/20 rounded text-[10px] font-bold uppercase tracking-wider mt-1">
              {user?.email === 'indiacybercafe.com@gmail.com' ? 'Super Admin' : (user?.role || 'User')}
            </span>
          </div>
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/30 transition-all z-20 border border-white/10"
            title="Close Sidebar"
          >
            <IconRenderer name="x" className="w-4 h-4" />
          </button>
        </div>

        <ul className="flex-1 p-3">
          {menuItems.map(item => (
            <li key={item.id} className="mb-1">
              <button
                onClick={() => { onNavigate(item.id); onClose(); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl text-slate-600 font-semibold transition-all hover:bg-primary/10 hover:text-primary hover:translate-x-1 border-l-4 border-transparent hover:border-primary text-sm"
              >
                <IconRenderer name={item.icon || 'layers'} className="w-5 h-5 opacity-70" />
                {item.label}
              </button>
            </li>
          ))}
          
          <li className="mt-auto pt-4 border-t border-slate-100">
            <div className="px-3 mb-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Connect With Us</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { name: 'facebook', url: 'https://www.facebook.com/share/17CF8MzE4n/', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/facebook.png' },
                  { name: 'instagram', url: 'https://www.instagram.com/indiacybercafe?igsh=bDVrbGN4eGRucmRp', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/instagram.png' },
                  { name: 'youtube', url: 'https://youtube.com/@india-cybercafe?si=rVycPzAVMzeKy9gA', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/youtube.png' },
                  { name: 'twitter', url: 'https://x.com/indiacybercafe_?t=3Jh0boTTaj_z6uLEBBxLVQ&s=09', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/twitter.png' },
                  { name: 'linkedin', url: 'https://www.linkedin.com/in/india-cyber-cafe-3481b8386?utm_source=share_via&utm_content=profile&utm_medium=member_android', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/linkedin.png' },
                  { name: 'snapchat', url: 'https://www.snapchat.com/add/indiacybercafe?share_id=JDrbhpRfolo&locale=en-IN', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/snapchat.png' },
                  { name: 'telegram', url: 'https://t.me/indiacybercafe', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/telegram.png' },
                  { name: 'whatsapp', url: 'https://whatsapp.com/channel/0029VbAAJQACsU9JgWj4Lq2C', icon: 'https://indiacybercafe.com/wp-content/uploads/2025/10/whatsapp.png' },
                ].map(social => (
                  <a 
                    key={social.name} 
                    href={social.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-primary/10 transition-all border border-slate-100 group"
                  >
                    <img src={social.icon} alt={social.name} className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-red-500 font-bold transition-all hover:bg-red-50 hover:translate-x-1 border-l-4 border-transparent hover:border-red-500 text-sm"
            >
              <IconRenderer name="right-from-bracket" className="w-5 h-5" />
              Logout
            </button>
          </li>
        </ul>
      </motion.div>
    </>
  );
}
