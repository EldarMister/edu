type BrandLogoProps = {
  className?: string;
  size?: 'header' | 'login';
};

export function BrandLogo({ className = '', size = 'header' }: BrandLogoProps) {
  const sizeClass = size === 'login' ? 'h-10' : 'h-6';

  return (
    <img
      src="/icon1.png"
      alt="EDU POS"
      className={`${sizeClass} w-auto object-contain ${className}`}
    />
  );
}
