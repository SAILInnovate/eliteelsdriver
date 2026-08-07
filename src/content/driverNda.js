// Elite ELS Limited — Driver Non-Disclosure & Confidentiality Agreement
// Adapted for individual drivers from the company NDA template.
// Bump NDA_VERSION whenever the wording changes so re-acceptance can be required.

export const NDA_VERSION = '2026-07';

export const NDA_TITLE = 'Non-Disclosure & Confidentiality Agreement';

// Returns the agreement as an ordered list of blocks with the driver's
// details filled into the gaps. Block types: 'title' | 'party' | 'heading' | 'text' | 'clause'
export function buildNda({ driverName, phone, effectiveDate }) {
    const name = driverName || '________________';
    const tel = phone ? ` (${phone})` : '';

    return [
        { type: 'text', body: `The effective date of this agreement is ${effectiveDate} (the “Effective Date”).` },

        { type: 'heading', body: 'BETWEEN' },
        { type: 'party', body: `(1) ELITE ELS LIMITED, a company incorporated in England & Wales under company number 11957968, whose registered address is at 55 Daresbury Street, Manchester M8 9LW (“Elite ELS Limited”); and` },
        { type: 'party', body: `(2) ${name}${tel} (the “Recipient”).` },

        { type: 'heading', body: 'BACKGROUND' },
        { type: 'text', body: 'Elite ELS Limited possesses certain information relating to, but not limited to, all information (however recorded or preserved) disclosed or made available, directly or indirectly, by Elite ELS Limited or its employees, officers, representatives or advisers to the Recipient in connection with the Recipient providing driving and related services to Elite ELS Limited (the “Purpose”), including but not limited to:' },
        { type: 'clause', num: '(a)', body: 'the fact that discussions and negotiations are taking place between the parties and the status of those discussions and negotiations;' },
        { type: 'clause', num: '(b)', body: 'the existence and terms of this agreement, those discussions, and any correspondence or communication relating to them;' },
        { type: 'clause', num: '(c)', body: 'any information that would be regarded as confidential by a reasonable business person relating to the business, affairs, customers, clients, suppliers, plans, intentions, or market opportunities of Elite ELS Limited;' },
        { type: 'clause', num: '(d)', body: 'any information or analysis derived from the Confidential Information; and' },
        { type: 'clause', num: '(e)', body: 'information relating to Elite ELS Limited’s current, potential or proposed projects and products, clients and suppliers (including their identity or the fact that they are clients or suppliers), business development, commercial, financial, operational, intellectual property and technical information which is of a confidential nature,' },
        { type: 'text', body: '(together, the “Confidential Information”).' },
        { type: 'text', body: 'Elite ELS Limited wishes to disclose to the Recipient, and wishes to ensure that the Recipient maintains the confidentiality of, the Confidential Information. In consideration of the benefits to the parties of disclosing and receiving the Confidential Information, the parties have agreed to comply with the following terms in connection with the use and disclosure of Confidential Information:' },

        { type: 'heading', body: 'AGREED TERMS' },

        { type: 'clause', num: '1.', body: 'Subject to clause 9, the Recipient shall:' },
        { type: 'clause', num: '(a)', body: 'keep the Confidential Information secret and confidential and not disclose any of it to any person or third party;' },
        { type: 'clause', num: '(b)', body: 'not disclose or make available the Confidential Information in whole or in part to any third party without the written permission of Elite ELS Limited, except as expressly permitted by this agreement;' },
        { type: 'clause', num: '(c)', body: 'only use the Confidential Information for the Purpose, and not exploit or make use of the Confidential Information to obtain a commercial, trading or other advantage;' },
        { type: 'clause', num: '(d)', body: 'not use the Confidential Information in any way which is directly or indirectly detrimental to Elite ELS Limited’s business;' },
        { type: 'clause', num: '(e)', body: 'not copy, reduce to writing or otherwise record the Confidential Information without the written permission of Elite ELS Limited (and any such copies, reductions to writing and records shall be the property of Elite ELS Limited);' },
        { type: 'clause', num: '(f)', body: 'not use, reproduce, transform, or store the Confidential Information in an externally accessible computer or electronic information retrieval system, or transmit it in any form or by any means whatsoever, other than as required for the Purpose;' },
        { type: 'clause', num: '(g)', body: 'keep the Confidential Information separate from all other documents and records of the Recipient;' },
        { type: 'clause', num: '(h)', body: 'apply the same security measures and degree of care to the Confidential Information as the Recipient applies to the Recipient’s own confidential information, which the Recipient warrants as providing adequate protection from unauthorised disclosure, copying or use; and' },
        { type: 'clause', num: '(i)', body: 'ensure that any document or other record containing Confidential Information is kept at Elite ELS Limited’s premises at 55 Daresbury Street, Manchester M8 9LW, and not remove or allow to be removed any such document or record from those premises without the written permission of Elite ELS Limited.' },

        { type: 'clause', num: '2.', body: 'Elite ELS Limited reserves all rights in its Confidential Information. No rights in respect of Elite ELS Limited’s Confidential Information are granted to the Recipient and no obligations are imposed on Elite ELS Limited other than those expressly stated in this agreement. In particular, nothing in this agreement shall be construed or implied as obliging Elite ELS Limited to disclose any specific type of information under the terms of this agreement, whether Confidential Information or not.' },

        { type: 'clause', num: '3.', body: 'The disclosure of Confidential Information by Elite ELS Limited shall not form any offer by, or representation or warranty on the part of, Elite ELS Limited to enter into any further agreement with the Recipient.' },

        { type: 'clause', num: '4.', body: 'Confidential Information disclosed to the Recipient pursuant to this agreement (and any intellectual property rights, or the ability to apply for registration of any intellectual property rights (whether registrable or not and whether known at the date of this agreement), derived therefrom) shall remain the exclusive property of Elite ELS Limited, and the Recipient shall do all such things and sign all such documents as may be required by Elite ELS Limited to give effect to this clause 4. No licence in respect of any such intellectual property rights or applications for intellectual property rights is granted by this agreement.' },

        { type: 'clause', num: '5.', body: 'Any Confidential Information made available to the Recipient in the course of, or for the purpose of, the Purpose shall not constitute an offer by or on behalf of any person to enter into any transaction, be intended to or be deemed to establish any partnership or joint venture between the parties, constitute either party the agent of the other, or authorise either party to make or enter into any commitment for or on behalf of the other party. Elite ELS Limited may terminate any negotiations or discussions with the Recipient and withhold further information at any time, without giving any reason and in its sole discretion.' },

        { type: 'clause', num: '6.', body: 'At the request of Elite ELS Limited at any time, the Recipient shall promptly:' },
        { type: 'clause', num: '(a)', body: 'destroy or return to Elite ELS Limited all documents and materials (and any copies) containing, reflecting, incorporating, or based on Elite ELS Limited’s Confidential Information;' },
        { type: 'clause', num: '(b)', body: 'erase all of Elite ELS Limited’s Confidential Information from the Recipient’s computer systems and devices;' },
        { type: 'clause', num: '(c)', body: 'deliver to Elite ELS Limited, or destroy, any written material prepared by or on behalf of the Recipient which is based on the Confidential Information or any part of it (for this purpose, “written” shall include, for the avoidance of doubt, information and data on any computer-readable media); and' },
        { type: 'clause', num: '(d)', body: 'certify in writing to Elite ELS Limited that the Recipient has complied with the requirements of this clause 6, provided that the Recipient may retain documents and materials containing, reflecting, incorporating, or based on Elite ELS Limited’s Confidential Information to the extent required by law or any applicable governmental or regulatory authority, and to the extent reasonable to permit the Recipient to keep evidence that the Recipient has performed the Recipient’s obligations under this agreement. The provisions of this agreement shall continue to apply to any documents and materials so retained by the Recipient.' },

        { type: 'clause', num: '7.', body: 'If the Recipient develops or uses a product or process which, in the reasonable opinion of Elite ELS Limited, might have involved the use of any of Elite ELS Limited’s Confidential Information, the Recipient shall, at the written request of Elite ELS Limited, supply all information reasonably necessary to establish that Elite ELS Limited’s Confidential Information has not been used or disclosed in order to develop or use that product or process.' },

        { type: 'clause', num: '8.', body: 'Neither party shall make, or permit any person to make, any public announcement concerning this agreement, its terms or the Confidential Information (including, for the avoidance of doubt, via any social media platform) without the prior written consent of the other party (such consent not to be unreasonably withheld or delayed), except as required by law or any governmental or regulatory authority (including, without limitation, any relevant securities exchange), or by any court or other authority of competent jurisdiction.' },

        { type: 'clause', num: '9.', body: 'The definition of “Confidential Information” above shall not apply to:' },
        { type: 'clause', num: '(a)', body: 'information which is or becomes generally available to the public otherwise than by breach of this agreement (except that any compilation of otherwise public information in a form not publicly known shall nevertheless be treated as Confidential Information);' },
        { type: 'clause', num: '(b)', body: 'information which was lawfully available to the Recipient on a non-confidential basis before the date of this agreement, as evidenced by written records;' },
        { type: 'clause', num: '(c)', body: 'information which is developed by or for the Recipient independently of the information disclosed by Elite ELS Limited, as evidenced by written records;' },
        { type: 'clause', num: '(d)', body: 'information which the parties agree in writing is not confidential or may be disclosed; and' },
        { type: 'clause', num: '(e)', body: 'information which is required to be disclosed by any applicable law, provided that, so far as it is lawful to do so prior to such disclosure, the Recipient shall promptly notify Elite ELS Limited of such requirement with a view to providing the opportunity for Elite ELS Limited to contest such disclosure or otherwise agree the timing and content of such disclosure.' },

        { type: 'clause', num: '10.', body: 'Neither Elite ELS Limited nor any of its advisers, agents, shareholders, directors, officers or employees accepts any responsibility or liability for, or makes any representation or warranty, express or implied, with respect to, the accuracy or completeness of the Confidential Information or any oral communication in connection therewith, or as to the reasonableness of any assumptions on which any of the same is based, or as to the absence of any material change therein.' },

        { type: 'clause', num: '11.', body: 'Except as subsequently agreed in any agreement to effect any transaction between Elite ELS Limited and the Recipient, or otherwise agreed in writing between the parties, the Recipient shall have no claim whatsoever against Elite ELS Limited or its advisers, agents, shareholders, directors, officers or employees (except any claim which shall arise from fraud or dishonesty) if all or any of the Confidential Information should prove to be inaccurate, incomplete or misleading in any respect whatsoever. Furthermore, in providing the Confidential Information, Elite ELS Limited does not undertake to provide the Recipient with access to any additional information.' },

        { type: 'clause', num: '12.', body: 'The Recipient shall not, for a period of two years after the date of this agreement, entice or solicit, or endeavour to entice or solicit, away from Elite ELS Limited any actual or prospective customer of Elite ELS Limited’s business, or any person who was employed by, or in connection with, the business at any time during the period of one year immediately prior to the date of this agreement, or who may have been employed subsequent to the date of this agreement and becomes known to the Recipient during and as a result of the Purpose.' },

        { type: 'clause', num: '13.', body: 'Without prejudice to any other rights or remedies that Elite ELS Limited may have, the Recipient acknowledges and agrees that (a) damages would not be an adequate remedy for any breach by the Recipient of the provisions of this agreement, (b) Elite ELS Limited shall be entitled to the remedies of injunction, specific performance and other equitable relief for any threatened or actual breach of the provisions of this agreement, and (c) no proof of special damages shall be necessary for the enforcement by Elite ELS Limited of the provisions of this agreement.' },

        { type: 'clause', num: '14.', body: 'The obligations of each party shall, notwithstanding any earlier termination of negotiations or discussions between the parties in relation to the Purpose, continue for a period of five (5) years from the termination of this agreement, at which time this agreement shall terminate. Termination of this agreement shall not affect any accrued rights or remedies to which Elite ELS Limited is entitled.' },

        { type: 'clause', num: '15.', body: 'The Recipient shall indemnify and keep fully indemnified Elite ELS Limited at all times against all liabilities, costs (including legal costs on an indemnity basis), expenses, damages and losses, including any direct, indirect or consequential losses, loss of profit, loss of reputation and all interest, penalties and other costs and expenses suffered or incurred by Elite ELS Limited arising from any breach of this agreement by the Recipient.' },

        { type: 'clause', num: '16.', body: 'No failure or delay by Elite ELS Limited in exercising any of its rights under this agreement shall operate as a waiver thereof, nor shall any single or partial exercise thereof preclude any further exercise or the exercise of any other right, power or privilege hereunder or otherwise.' },

        { type: 'clause', num: '17.', body: 'The Recipient shall not be entitled to assign any rights or obligations under this agreement.' },

        { type: 'clause', num: '18.', body: 'This agreement constitutes the entire agreement between the parties in respect of its subject matter and supersedes and extinguishes all previous drafts, agreements, arrangements and understandings between them, whether written or oral, relating to its subject matter.' },

        { type: 'clause', num: '19.', body: 'Each party agrees that it shall have no remedies in respect of any representation or warranty (whether made innocently or negligently) that is not set out in this agreement. Each party agrees that its only liability in respect of those representations and warranties that are set out in this agreement (whether made innocently or negligently) shall be for breach of contract.' },

        { type: 'clause', num: '20.', body: 'No variation of this agreement shall be effective unless it is in writing and signed by each of the parties (or their authorised representatives).' },

        { type: 'clause', num: '21.', body: 'This agreement is made for the benefit of the parties to it and their successors and permitted assigns, and is not intended to benefit, or be enforceable by, anyone else.' },

        { type: 'clause', num: '22.', body: 'This agreement and any dispute or claim arising out of or in connection with it or its subject matter or formation (including non-contractual disputes or claims) shall be governed by and construed in accordance with the law of England and Wales. The parties irrevocably agree that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim that arises out of or in connection with this agreement or its subject matter or formation (including non-contractual disputes or claims).' },

        { type: 'clause', num: '23.', body: 'The Recipient agrees that acceptance of this agreement electronically within the Elite ELS driver app — by entering the Recipient’s full legal name and tapping “Agree & Sign” — constitutes valid execution of this agreement and shall have the same legal effect as a signature on an original paper counterpart.' },

        { type: 'text', body: 'This agreement has been entered into on the Effective Date stated at the beginning of it.' },
    ];
}
