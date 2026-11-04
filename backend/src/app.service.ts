import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'Zeno Wallet API',
      version: '0.0.1',
      docs: 'See PLAN.md and README.md at repository root.',
    };
  }
}
