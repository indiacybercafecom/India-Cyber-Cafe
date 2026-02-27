import { 
  Home, 
  Layers, 
  ClipboardList, 
  UserPen, 
  ShieldHalf, 
  Monitor, 
  LogOut, 
  X,
  Fingerprint,
  IdCard,
  Search,
  CheckCircle,
  Clock,
  Zap,
  ShieldCheck,
  Smartphone,
  Headset,
  UserPlus,
  User,
  Mail,
  Phone,
  Lock,
  FileText,
  Send,
  Eye,
  EyeOff,
  Star,
  Camera,
  Download,
  Trash2,
  Plus,
  ChevronDown,
  CreditCard,
  HandCoins,
  CalendarCheck,
  History,
  Info,
  AlertCircle,
  FileSpreadsheet,
  ArrowLeft,
  Globe,
  Upload
} from 'lucide-react';

export const Icons = {
  Home,
  Layers,
  ClipboardList,
  UserPen,
  ShieldHalf,
  Monitor,
  LogOut,
  X,
  Fingerprint,
  IdCard,
  Search,
  CheckCircle,
  Clock,
  Zap,
  ShieldCheck,
  Smartphone,
  Headset,
  UserPlus,
  User,
  Mail,
  Phone,
  Lock,
  FileText,
  Send,
  Eye,
  EyeOff,
  Star,
  Camera,
  Download,
  Trash2,
  Plus,
  ChevronDown,
  CreditCard,
  HandCoins,
  CalendarCheck,
  History,
  Info,
  AlertCircle,
  FileSpreadsheet,
  ArrowLeft,
  Globe,
  Upload
};

export function IconRenderer({ name, className }: { name: string; className?: string }) {
  // Map font-awesome names to Lucide icons where possible
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('fingerprint')) return <Icons.Fingerprint className={className} />;
  if (lowerName.includes('id-card')) return <Icons.IdCard className={className} />;
  if (lowerName.includes('house') || lowerName.includes('home')) return <Icons.Home className={className} />;
  if (lowerName.includes('layer-group')) return <Icons.Layers className={className} />;
  if (lowerName.includes('list-check')) return <Icons.ClipboardList className={className} />;
  if (lowerName.includes('user-pen')) return <Icons.UserPen className={className} />;
  if (lowerName.includes('shield-halved')) return <Icons.ShieldHalf className={className} />;
  if (lowerName.includes('desktop')) return <Icons.Monitor className={className} />;
  if (lowerName.includes('right-from-bracket')) return <Icons.LogOut className={className} />;
  if (lowerName.includes('users')) return <Icons.UserPlus className={className} />;
  if (lowerName === 'user') return <Icons.User className={className} />;
  if (lowerName.includes('envelope') || lowerName.includes('mail')) return <Icons.Mail className={className} />;
  if (lowerName.includes('phone')) return <Icons.Phone className={className} />;
  if (lowerName.includes('lock')) return <Icons.Lock className={className} />;
  if (lowerName === 'x' || lowerName.includes('close') || lowerName.includes('xmark')) return <Icons.X className={className} />;
  if (lowerName.includes('file-check') || lowerName.includes('check-circle')) return <Icons.CheckCircle className={className} />;
  if (lowerName.includes('handshake')) return <Icons.Headset className={className} />;
  if (lowerName.includes('star')) return <Icons.Star className={className} />;
  if (lowerName.includes('bolt')) return <Icons.Zap className={className} />;
  if (lowerName.includes('mobile')) return <Icons.Smartphone className={className} />;
  if (lowerName.includes('clock')) return <Icons.Clock className={className} />;
  if (lowerName.includes('paper-plane')) return <Icons.Send className={className} />;
  if (lowerName.includes('eye-slash') || lowerName.includes('eye-off')) return <Icons.EyeOff className={className} />;
  if (lowerName.includes('eye')) return <Icons.Eye className={className} />;
  if (lowerName.includes('camera')) return <Icons.Camera className={className} />;
  if (lowerName.includes('download')) return <Icons.Download className={className} />;
  if (lowerName.includes('trash')) return <Icons.Trash2 className={className} />;
  if (lowerName.includes('plus')) return <Icons.Plus className={className} />;
  if (lowerName.includes('credit-card')) return <Icons.CreditCard className={className} />;
  if (lowerName.includes('hand-holding-dollar')) return <Icons.HandCoins className={className} />;
  if (lowerName.includes('calendar-check')) return <Icons.CalendarCheck className={className} />;
  if (lowerName.includes('history')) return <Icons.History className={className} />;
  if (lowerName.includes('info')) return <Icons.Info className={className} />;
  if (lowerName.includes('exclamation')) return <Icons.AlertCircle className={className} />;
  if (lowerName.includes('excel') || lowerName.includes('spreadsheet')) return <Icons.FileSpreadsheet className={className} />;
  if (lowerName.includes('arrow-left')) return <Icons.ArrowLeft className={className} />;
  if (lowerName.includes('globe')) return <Icons.Globe className={className} />;
  if (lowerName.includes('upload')) return <Icons.Upload className={className} />;
  
  return <Icons.FileText className={className} />;
}
