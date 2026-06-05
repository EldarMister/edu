// Минимальные line-иконки (по духу референсов — без декоративности).
type P = { className?: string };
const S = ({ children, className }: P & { children: React.ReactNode }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

export const IconStats = (p: P) => (
  <S {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 14l3-3 3 3 5-6" />
  </S>
);
export const IconOrders = (p: P) => (
  <S {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </S>
);
export const IconTables = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </S>
);
export const IconMenu = (p: P) => (
  <S {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </S>
);
export const IconStaff = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2 21c0-3.5 3.5-5.5 7-5.5s7 2 7 5.5" />
    <path d="M17 8a3 3 0 0 1 0 6M22 21c0-2.5-1.5-4.2-3.5-5" />
  </S>
);
export const IconMoney = (p: P) => (
  <S {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <circle cx="12" cy="12" r="3" />
  </S>
);
export const IconCheck = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </S>
);
export const IconX = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9l-6 6M9 9l6 6" />
  </S>
);
export const IconClock = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);
export const IconHall = (p: P) => (
  <S {...p}>
    <path d="M3 21V8l9-5 9 5v13" />
    <path d="M3 21h18M9 21v-6h6v6" />
  </S>
);
export const IconCategory = (p: P) => (
  <S {...p}>
    <path d="M4 5h16M4 12h16M4 19h16" />
    <circle cx="7" cy="5" r="0.5" />
  </S>
);
export const IconEdit = (p: P) => (
  <S {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </S>
);
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </S>
);
export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const IconLogout = (p: P) => (
  <S {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </S>
);
export const IconUsers = (p: P) => IconStaff(p);
