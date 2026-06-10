import Image from 'next/image';
import { Star } from 'lucide-react';

import { Avatar } from '@/shared/components/ui/avatar';

const userImgUrls = [
  '/imgs/avatars/1.webp',
  '/imgs/avatars/2.webp',
  '/imgs/avatars/3.webp',
  '/imgs/avatars/4.webp',
  '/imgs/avatars/5.webp',
  '/imgs/avatars/6.webp',
];

export function SocialAvatars({ tip }: { tip: string }) {
  return (
    <div className="mx-auto mt-8 flex w-fit flex-col items-center gap-2 sm:flex-row">
      <span className="mx-4 inline-flex items-center -space-x-2">
        {userImgUrls.map((url, index) => (
          <Avatar className="size-10 border" key={index}>
            <Image width={40} height={40} src={url} alt="placeholder" />
          </Avatar>
        ))}
      </span>
      <div className="flex flex-col items-center gap-1 md:items-start">
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <Star
              key={index}
              className="size-4 fill-yellow-400 text-yellow-400"
            />
          ))}
        </div>
        <p className="text-muted-foreground text-left text-sm font-normal">
          {tip}
        </p>
      </div>
    </div>
  );
}
