import mascot from '../assets/freetalk-mascot.png';
import './service-bot-avatar.css';

export const SERVICE_BOT_AVATAR_URL = mascot;

export function ServiceBotAvatar({
  className = '',
  alt = '',
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <span className={`service-bot-avatar ${className}`}>
      <img src={mascot} alt={alt} draggable={false} />
    </span>
  );
}
