export type MomoStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface RequestToPayInput {
  referenceId: string;
  amountCents: number;
  payerMsisdn: string;
  externalId: string;
  payerMessage: string;
  payeeNote: string;
}

export interface TransferInput {
  referenceId: string;
  amountCents: number;
  payeeMsisdn: string;
  externalId: string;
  payerMessage: string;
  payeeNote: string;
}

export interface TransactionStatus {
  referenceId: string;
  status: MomoStatus;
  financialTransactionId: string | null;
  reason: string | null;
}

export interface MomoProvider {
  readonly name: 'live' | 'mock';
  requestToPay(input: RequestToPayInput): Promise<void>;
  getRequestToPayStatus(referenceId: string): Promise<TransactionStatus>;
  transfer(input: TransferInput): Promise<void>;
  getTransferStatus(referenceId: string): Promise<TransactionStatus>;
  isAccountActive(msisdn: string): Promise<boolean>;
}
