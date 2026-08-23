import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';

type FrameShape = { width?: number; height?: number } | string;

function AssetImage({ src, alt = '', frameShape }: { src: string; alt?: string; frameShape?: FrameShape }) {
  const shape = typeof frameShape === 'object' ? frameShape : undefined;
  return <img className="web-asset-image" src={src} alt={alt} style={{ width: shape?.width, height: shape?.height }} />;
}

function AssetIcon({ color = '#ff506f', backgroundColor, ...props }: HTMLAttributes<HTMLSpanElement> & { name: string; color?: string; backgroundColor?: string; frameShape?: FrameShape }) {
  return <span {...props} className={`web-asset-icon ${props.className ?? ''}`} style={{ color, backgroundColor }} aria-hidden="true">♥</span>;
}

export const Asset = {
  Image: AssetImage,
  Icon: AssetIcon,
  frameShape: { CircleLarge: 'circle-large', CleanH24: 'clean-h24' },
};

type WebButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  display?: 'full' | string;
  size?: 'small' | 'medium' | 'large' | string;
  color?: 'dark' | 'primary' | string;
  variant?: 'fill' | 'weak' | string;
  loading?: boolean;
};

export function Button({ display, size = 'medium', color, variant, loading, className = '', children, ...props }: WebButtonProps) {
  return (
    <button
      {...props}
      className={`web-button size-${size} ${display === 'full' ? 'is-full' : ''} ${color ? `color-${color}` : ''} ${variant ? `variant-${variant}` : ''} ${className}`}
    >
      {loading ? '잠시만요…' : children}
    </button>
  );
}

type TopProps = {
  className?: string;
  upperGap?: number;
  lowerGap?: number;
  title: ReactNode;
  subtitleBottom?: ReactNode;
};

function TopRoot({ className = '', upperGap = 0, lowerGap = 0, title, subtitleBottom }: TopProps) {
  return <section className={`web-top ${className}`} style={{ paddingTop: upperGap, paddingBottom: lowerGap }}>{title}{subtitleBottom}</section>;
}

function TitleParagraph({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return <h1 className="web-top-title" style={{ fontSize: size }}>{children}</h1>;
}

function SubtitleParagraph({ children }: { children: ReactNode }) {
  return <h2 className="web-top-subtitle">{children}</h2>;
}

export const Top = Object.assign(TopRoot, { TitleParagraph, SubtitleParagraph });

export function TopNavigation({ leading, content, background, className = '' }: { leading?: ReactNode; content?: ReactNode; background?: string; withSafeAreaTop?: boolean; className?: string }) {
  return <nav className={`web-top-navigation ${className}`} style={{ background }}>{leading}<strong>{content}</strong></nav>;
}

export function TopNavigationBackButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`web-back-button ${props.className ?? ''}`} type="button">‹</button>;
}

type ResultProps = { figure?: ReactNode; title: ReactNode; description?: ReactNode; button?: ReactNode };

function ResultRoot({ figure, title, description, button }: ResultProps) {
  return <section className="web-result">{figure}<h1>{title}</h1><div>{description}</div>{button}</section>;
}

export const Result = Object.assign(ResultRoot, { Button });

export function Toast({ open, text, className = '', ...props }: { position?: string; open: boolean; text: string; className?: string; 'aria-live'?: 'off' | 'polite' | 'assertive' }) {
  if (!open) return null;
  return <div className={`web-toast ${className}`} role="status" aria-live={props['aria-live'] ?? 'polite'}>{text}</div>;
}

export function TextButton({ color, variant, size, className = '', style, ...props }: WebButtonProps & { style?: CSSProperties }) {
  return <button {...props} className={`web-text-button ${className}`} style={{ ...style, color }} type="button" />;
}

type ConfirmDialogProps = {
  open?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  cancelButton?: ReactNode;
  confirmButton?: ReactNode;
  closeOnBackEvent?: boolean;
  onClose?: () => void;
};

function ConfirmDialogRoot({ open, title, description, cancelButton, confirmButton, onClose }: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="web-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <section className="web-dialog" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : '안내'}>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="web-dialog-actions">{cancelButton}{confirmButton}</div>
      </section>
    </div>
  );
}

function ConfirmButton(props: WebButtonProps) {
  return <Button {...props} size="large" />;
}

function CancelButton(props: WebButtonProps) {
  return <Button {...props} size="large" color="dark" variant="weak" />;
}

export const ConfirmDialog = Object.assign(ConfirmDialogRoot, { ConfirmButton, CancelButton });
